import { auth, db, EKINERJA_APPS_SCRIPT_URL } from './config.js';
import { initLayout } from './global.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { doc, getDoc, collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { cfClient } from './cloudflare-client.js';
import { parseDate, formatYMD, escapeHTML, showConfirmModal, calculateEffectiveMinutes } from './agenda-common.js';
import {
    REKAP_MONTH_NAMES,
    resolveRekapReportPeriod,
    isDateInRekapPeriod,
    nextRekapWeekRange,
    buildRekapPeriodChipsHtml,
    pickRekapReportActivities,
    buildRekapInfographicHtml,
    fitRekapPreviewFrame,
    isGenericCaption
} from './rekap-infographic.js';
import { reorderArrayItems, setupPhotoGridDragAndDrop } from './utils-photo-dnd.mjs';

let currentUserRole = null;
let currentUserName = null;
let currentUserUid = null;
let isSupervisor = false;
let isSuperAdmin = false;
let isKepsek = false;
let isMonitoringMode = false;
let hasEmployeeVipAccess = false;
let _vipConfig = { all_tendik: false, allowed_gtk_ids: [], allowed_uids: [] };
let _vipSearchQuery = '';

let selectedDate = formatYMD(new Date());
let selectedEmployeeGtkId = '';
let selectedEmployeeUid = '';
let selectedEmployeeName = '';

let masterSkData = null;
let employeeAssignments = [];
let allAssignmentsList = [];
let activitiesList = [];
let currentWeeklyActivities = [];
let editingActivityId = null;
let currentDayAbsence = null;
let weeklyAbsencesMap = new Map();

window.escapeHTML = escapeHTML;

/**
 * Standar Butir Penugasan Pokok Kepala Sekolah (Permendikdasmen No. 23/2026)
 */
export const DEFAULT_PRINCIPAL_GROUPS = [
    {
        id: 'ks-group-1',
        kode_kelompok: 'KS-01',
        group_code: 'KS-01',
        nama_kelompok: 'Visi dan Budaya Belajar',
        group_name: 'Visi dan Budaya Belajar',
        uraian_tugas: 'Mengembangkan visi, misi, tujuan, serta budaya belajar satuan pendidikan.',
        urutan: 1,
        is_principal: 1
    },
    {
        id: 'ks-group-2',
        kode_kelompok: 'KS-02',
        group_code: 'KS-02',
        nama_kelompok: 'Iklim Lingkungan Belajar',
        group_name: 'Iklim Lingkungan Belajar',
        uraian_tugas: 'Memimpin perwujudan lingkungan satuan pendidikan yang aman, nyaman, sehat, inklusif, kondusif, dan ramah keragaman.',
        urutan: 2,
        is_principal: 1
    },
    {
        id: 'ks-group-3',
        kode_kelompok: 'KS-03',
        group_code: 'KS-03',
        nama_kelompok: 'Kurikulum dan Pembelajaran',
        group_name: 'Kurikulum dan Pembelajaran',
        uraian_tugas: 'Memimpin kurikulum dan pembelajaran berpusat pada murid melalui supervisi, evaluasi, refleksi, serta pendampingan berkelanjutan berbasis data demi menciptakan pembelajaran yang bermakna, berkesadaran, menggembirakan, dan kontekstual.',
        urutan: 3,
        is_principal: 1
    },
    {
        id: 'ks-group-4',
        kode_kelompok: 'KS-04',
        group_code: 'KS-04',
        nama_kelompok: 'Tata Kelola dan Sumber Daya',
        group_name: 'Tata Kelola dan Sumber Daya',
        uraian_tugas: 'Mengelola program dan sumber daya satuan pendidikan secara terencana, sistemik, transparan, akuntabel, efektif, efisien, dan berbasis data pada seluruh siklus perencanaan, pelaksanaan, serta evaluasi.',
        urutan: 4,
        is_principal: 1
    },
    {
        id: 'ks-group-5',
        kode_kelompok: 'KS-05',
        group_code: 'KS-05',
        nama_kelompok: 'Kemitraan Eksternal',
        group_name: 'Kemitraan Eksternal',
        uraian_tugas: 'Membangun kerja sama dengan orang tua/wali murid dan masyarakat untuk memajukan pembelajaran serta layanan pendidikan.',
        urutan: 5,
        is_principal: 1
    },
    {
        id: 'ks-group-6',
        kode_kelompok: 'KS-06',
        group_code: 'KS-06',
        nama_kelompok: 'Kepemimpinan Transformasional',
        group_name: 'Kepemimpinan Transformasional',
        uraian_tugas: 'Mendorong inovasi, kewirausahaan, dan kepemimpinan transformasional agar satuan pendidikan adaptif terhadap dinamika zaman serta kebutuhan masa depan.',
        urutan: 6,
        is_principal: 1
    }
];

/**
 * Parser Cerdas untuk Memisahkan Judul Singkat Tugas Pokok & Uraian Butir Tugas Kepala Sekolah
 * Menjamin kompatibilitas dengan format baru (2 kolom) maupun data lama (format titik dua ':' atau abjad)
 */
export function parsePrincipalGroupFields(group) {
    if (!group) return { title: '', desc: '' };
    let rawTitle = String(group.nama_kelompok || group.group_name || '').trim();
    let rawDesc = String(group.uraian_tugas || group.task_description || group.description || '').trim();

    // Fallback parser jika uraian_tugas belum ada di D1 tapi judul memuat tanda titik dua (:)
    if (!rawDesc && rawTitle.includes(':')) {
        const parts = rawTitle.split(':');
        rawTitle = parts[0].trim();
        rawDesc = parts.slice(1).join(':').trim();
    }

    // Bersihkan awalan abjad seperti "a. ", "b. ", dst. dari judul jika ada
    rawTitle = rawTitle.replace(/^[a-z]\.\s*/i, '').trim();

    return { title: rawTitle, desc: rawDesc };
}
if (typeof window !== 'undefined') {
    window.parsePrincipalGroupFields = parsePrincipalGroupFields;
}

export function isPrincipalGroup(group) {
    if (!group) return false;
    if (group.is_principal === 1 || group.is_principal === true || group.is_principal === '1') return true;
    const code = String(group.kode_kelompok || group.group_code || '').toUpperCase();
    return code.startsWith('KS-') || code === 'KS';
}

export function isCurrentTargetPrincipal() {
    if (selectedEmployeeGtkId && typeof allGtkList !== 'undefined' && Array.isArray(allGtkList)) {
        const found = allGtkList.find(g => String(g.id) === String(selectedEmployeeGtkId));
        if (found) {
            const role = String(found.role || found.jabatan || found.jenis_ptk || '').toLowerCase();
            return role.includes('kepala') || role.includes('kepsek') || role.includes('principal');
        }
    }
    const allRoles = (typeof window !== 'undefined' && window.getAllUserRoles ? window.getAllUserRoles() : [currentUserRole]).filter(Boolean);
    return currentUserRole === 'kepala_sekolah' || allRoles.includes('kepala_sekolah') || (typeof window !== 'undefined' && window.hasRole && window.hasRole('kepala_sekolah'));
}

// Konfigurasi & State Unggah Foto Bukti Kegiatan (Maks. 2 Foto, Kompresi Canvas, Google Drive)
const MAX_EMPLOYEE_PHOTOS = 2;
const APPS_SCRIPT_URL = EKINERJA_APPS_SCRIPT_URL;

let _currentActivityPhotos = [];
let _activityPhotoUploadSeq = 0;
let _employeeLightboxPhotos = [];
let _employeeLightboxIndex = 0;
let _employeeLightboxTouchListener = false;
let _employeeLightboxKeyListener = false;
let _supervisorDetailActivitiesMap = new Map();

/**
 * Ekstraksi ID Berkas dari Tautan Google Drive
 */
export function extractGoogleDriveFileId(url) {
    if (!url || typeof url !== 'string') return null;
    const patterns = [
        /\/file\/d\/([a-zA-Z0-9_-]+)/,
        /id=([a-zA-Z0-9_-]+)/,
        /\/d\/([a-zA-Z0-9_-]+)/,
        /\/open\?id=([a-zA-Z0-9_-]+)/,
        /\/uc\?(?:[^&]*&)*id=([a-zA-Z0-9_-]+)/
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m && m[1]) return m[1];
    }
    return null;
}

/**
 * Dapatkan URL Thumbnail Google Drive yang dioptimasi
 */
export function getGoogleDriveThumbnail(url) {
    if (!url) return '';
    const fileId = extractGoogleDriveFileId(url);
    if (fileId) {
        return `https://lh3.googleusercontent.com/d/${fileId}=w400`;
    }
    return url;
}

/**
 * Parsing multi-foto dari nilai bukti_url database D1
 * Mendukung JSON string array [{ url, fileId, name }] maupun single URL string legacy
 */
export function parseEvidencePhotos(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) {
        return raw.map((item, idx) => {
            if (typeof item === 'string') {
                return { url: item, fileId: extractGoogleDriveFileId(item), name: `Foto Bukti ${idx + 1}` };
            }
            if (item && item.url) {
                return {
                    url: item.url,
                    fileId: item.fileId || extractGoogleDriveFileId(item.url),
                    name: item.name || `Foto Bukti ${idx + 1}`
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
                            return { url: item, fileId: extractGoogleDriveFileId(item), name: `Foto Bukti ${idx + 1}` };
                        }
                        if (item && item.url) {
                            return {
                                url: item.url,
                                fileId: item.fileId || extractGoogleDriveFileId(item.url),
                                name: item.name || `Foto Bukti ${idx + 1}`
                            };
                        }
                        return null;
                    }).filter(Boolean);
                }
            } catch (_) {}
        }
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            return [{ url: trimmed, fileId: extractGoogleDriveFileId(trimmed), name: 'Foto Bukti' }];
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
        // HEIC hanya dapat dibaca oleh peramban yang mendukungnya (mis. Safari); selain itu beri pesan yang jelas
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

                // Target Base64 max ~80KB (1 char ~= 0.75 byte)
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
 * Hierarki folder: Agenda-Pegawai / YYYY-MM / Nama_Pegawai
 */
export async function uploadEmployeePhotoToGoogleDrive(base64Data, fileName, folderContext = {}, maxRetries = 3, onRetry = null) {
    const employeeName = folderContext.employeeName || selectedEmployeeName || currentUserName || 'Pegawai';
    const yearMonth = folderContext.yearMonth || (new Date().toISOString().slice(0, 7));
    const safeName = employeeName.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'Pegawai';
    const folderPath = `Agenda-Pegawai/${yearMonth}/${safeName}`;

    let lastError = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 1 && typeof onRetry === 'function') {
                try { onRetry(attempt, maxRetries); } catch (_) {}
            }

            const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timeoutId = controller ? setTimeout(() => controller.abort(), 35000) : null;

            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({
                    action: 'upload',
                    image: base64Data,
                    fileName: fileName,
                    folderPath: folderPath,
                    guruName: safeName,
                    yearMonth: yearMonth,
                    kelas: folderPath
                }),
                signal: controller ? controller.signal : undefined
            });
            if (timeoutId) clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`Layanan foto mengembalikan HTTP ${response.status}.`);
            }

            const result = await response.json();
            if (!result.success) throw new Error(result.error || 'Pengunggahan foto gagal.');
            if (!result.url) throw new Error('Respons pengunggahan tidak menyertakan tautan foto.');
            return { url: result.url, fileId: result.fileId, name: fileName };
        } catch (err) {
            lastError = err;
            if (attempt < maxRetries) {
                const delayMs = attempt * 1500;
                await new Promise(r => setTimeout(r, delayMs));
            }
        }
    }

    throw lastError || new Error('Gagal mengunggah foto setelah beberapa percobaan.');
}

/**
 * Hapus foto dari Google Drive di latar belakang (fire and forget)
 */
export async function deleteEmployeePhotoFromGoogleDrive(fileId) {
    if (!fileId) return;
    try {
        fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'delete',
                fileId: fileId
            })
        }).catch(e => console.warn('[EmployeeAgenda Delete Photo]', e));
    } catch (e) {
        console.warn('[EmployeeAgenda Delete Photo]', e);
    }
}

/**
 * Mengatur ulang urutan foto bukti aktivitas tendik secara interaktif
 * @param {number} fromIndex - Indeks kartu asal
 * @param {number} toIndex - Indeks kartu tujuan
 */
export function reorderActivityPhoto(fromIndex, toIndex) {
    if (
        fromIndex === toIndex ||
        fromIndex < 0 || toIndex < 0 ||
        fromIndex >= _currentActivityPhotos.length || toIndex >= _currentActivityPhotos.length
    ) {
        return;
    }
    _currentActivityPhotos = reorderArrayItems(_currentActivityPhotos, fromIndex, toIndex);
    renderActivityPhotosGrid();
}

/**
 * Render Grid Foto Bukti pada Formulir Modal Aktivitas (Tanpa Input Caption)
 */
export function renderActivityPhotosGrid() {
    const grid = document.getElementById('form-activity-photos-grid');
    const countEl = document.getElementById('form-activity-photos-count');
    const btnAdd = document.getElementById('btn-add-activity-photo');
    if (!grid) return;

    // Simpan fokus kursor jika pengguna sedang mengetik keterangan foto
    const activeEl = document.activeElement;
    let activeIndex = -1, selStart = 0, selEnd = 0;
    if (activeEl && activeEl.hasAttribute('data-photo-caption-index')) {
        activeIndex = parseInt(activeEl.getAttribute('data-photo-caption-index'), 10);
        selStart = activeEl.selectionStart || 0;
        selEnd = activeEl.selectionEnd || 0;
    }

    const count = _currentActivityPhotos.length;
    if (countEl) {
        countEl.textContent = `${count} / ${MAX_EMPLOYEE_PHOTOS} Foto`;
        countEl.className = count >= MAX_EMPLOYEE_PHOTOS
            ? 'text-[10px] font-bold text-amber-600 dark:text-amber-400'
            : 'text-[10px] font-bold text-slate-400';
    }
    const btnCamera = document.getElementById('btn-camera-activity-photo');
    if (btnCamera) {
        btnCamera.disabled = count >= MAX_EMPLOYEE_PHOTOS;
        btnCamera.classList.toggle('opacity-50', count >= MAX_EMPLOYEE_PHOTOS);
        btnCamera.classList.toggle('cursor-not-allowed', count >= MAX_EMPLOYEE_PHOTOS);
        btnCamera.classList.toggle('cursor-pointer', count < MAX_EMPLOYEE_PHOTOS);
    }
    if (btnAdd) {
        btnAdd.disabled = count >= MAX_EMPLOYEE_PHOTOS;
        btnAdd.classList.toggle('opacity-50', count >= MAX_EMPLOYEE_PHOTOS);
        btnAdd.classList.toggle('cursor-not-allowed', count >= MAX_EMPLOYEE_PHOTOS);
        btnAdd.classList.toggle('cursor-pointer', count < MAX_EMPLOYEE_PHOTOS);
    }

    if (count === 0) {
        grid.innerHTML = `
            <div class="col-span-full py-3.5 px-3 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-center text-slate-400 text-xs flex flex-col items-center justify-center gap-1 bg-slate-50/50 dark:bg-slate-900/30">
                <i class="fa-regular fa-images text-xl text-slate-300 dark:text-slate-600"></i>
                <span class="text-[11px]">Belum ada foto bukti diunggah (wajib min. 1 foto, maks. ${MAX_EMPLOYEE_PHOTOS} foto)</span>
            </div>`;
        return;
    }

    let html = '';
    _currentActivityPhotos.forEach((photo, idx) => {
        const thumbUrl = photo.localPreview || (photo.url ? getGoogleDriveThumbnail(photo.url) : '');
        const isUploading = photo.state === 'uploading';
        const isFailed = photo.state === 'failed';
        const captionVal = escapeHTML(photo.caption || '');

        html += `
            <div class="photo-card-item flex flex-col gap-1 p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 shadow-2xs transition-all hover:border-emerald-300 dark:hover:border-emerald-800 cursor-default" data-photo-index="${idx}">
                <div class="relative group rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 aspect-video flex items-center justify-center">
                    ${thumbUrl ? `
                        <img src="${thumbUrl}" alt="Bukti ${idx + 1}" class="w-full h-full object-cover cursor-pointer transition-transform group-hover:scale-105" onclick="window.previewActivityPhotoInModal(${idx})" title="Klik untuk perbesar foto">
                    ` : `
                        <div class="w-full h-full flex items-center justify-center text-slate-400"><i class="fa-solid fa-image text-xl"></i></div>
                    `}

                    ${isUploading ? `
                        <div class="absolute inset-0 bg-black/60 backdrop-blur-2xs flex flex-col items-center justify-center text-white text-[10px] gap-1 z-10 p-1 text-center">
                            <i class="fa-solid fa-circle-notch animate-spin text-sm text-emerald-400"></i>
                            <span class="font-semibold leading-tight">${photo.uploadStatusText || 'Mengunggah...'}</span>
                        </div>
                    ` : ''}

                    ${isFailed ? `
                        <div class="absolute inset-0 bg-rose-950/85 backdrop-blur-2xs flex flex-col items-center justify-center text-white text-[10px] gap-1 z-10 p-1.5 text-center">
                            <i class="fa-solid fa-triangle-exclamation text-rose-400 text-sm"></i>
                            <span class="text-[9px] text-rose-200 font-semibold leading-tight line-clamp-1">Gagal Unggah</span>
                            <button type="button" onclick="event.stopPropagation(); window.retryActivityPhoto(${idx})" class="mt-0.5 px-2 py-0.5 rounded-md bg-rose-600 hover:bg-rose-500 active:scale-95 text-white text-[9px] font-bold flex items-center gap-1 shadow-xs transition-all cursor-pointer" title="Coba unggah ulang foto ini">
                                <i class="fa-solid fa-rotate-right text-[8px]"></i>
                                <span>Coba Lagi</span>
                            </button>
                        </div>
                    ` : ''}

                    <!-- Handle Drag Grip Geser Posisi (Pojok Kiri Atas - Touch & Mouse Friendly) -->
                    ${count > 1 ? `
                    <div
                        class="photo-drag-handle absolute top-1.5 left-1.5 w-6 h-6 rounded-lg bg-black/75 hover:bg-black/90 active:scale-95 text-white/90 hover:text-white flex items-center justify-center text-[10px] transition-all z-20 cursor-grab active:cursor-grabbing shadow-xs touch-none select-none"
                        title="Tahan dan geser untuk ubah urutan foto"
                        data-photo-index="${idx}"
                        draggable="false"
                    >
                        <i class="fa-solid fa-grip-vertical"></i>
                    </div>` : ''}

                    <!-- Tombol Hapus ❌ (Touch-friendly di mobile & desktop) -->
                    <button type="button" onclick="event.stopPropagation(); window.removeActivityPhoto(${idx})" class="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/75 hover:bg-rose-600 active:scale-90 text-white flex items-center justify-center text-[10px] transition-all z-20 cursor-pointer shadow-xs" title="Hapus foto ini">
                        <i class="fa-solid fa-xmark"></i>
                    </button>

                    <!-- Label Posisi & Badge Foto -->
                    <div class="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-2xs text-[9px] font-bold text-white flex items-center gap-1.5 z-10 pointer-events-none">
                        <i class="fa-regular fa-image text-emerald-400 text-[10px]"></i>
                        <span>Foto ${idx + 1}</span>
                    </div>
                </div>

                <!-- Input Keterangan / Caption Foto (Compact Multi-Line Auto-Wrap) -->
                <div class="flex flex-col gap-0.5">
                    <label class="text-[9px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1">
                        <i class="fa-regular fa-comment-dots text-emerald-500 text-[9px]"></i>
                        <span>Keterangan Foto ${idx + 1}</span>
                    </label>
                    <textarea
                        rows="2"
                        maxlength="150"
                        data-photo-caption-index="${idx}"
                        oninput="window.updateActivityPhotoCaption(${idx}, this.value)"
                        placeholder="Contoh: Dokumentasi pelaksanaan tugas..."
                        title="Keterangan untuk foto ${idx + 1} (opsional)"
                        class="w-full px-2 py-1 text-[10px] leading-snug rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:bg-white dark:focus:bg-slate-950 transition-all resize-none overflow-y-auto"
                    >${captionVal}</textarea>
                </div>
            </div>
        `;
    });

    grid.innerHTML = html;

    // Hubungkan event Drag-and-Drop serta sentuh mobile pada grid foto
    setupPhotoGridDragAndDrop(grid, {
        handleSelector: '.photo-drag-handle',
        cardSelector: '.photo-card-item',
        onReorder: reorderActivityPhoto
    });

    // Kembalikan fokus kursor jika pengguna sedang mengetik saat foto selesai diunggah
    if (activeIndex >= 0) {
        const newActiveInput = grid.querySelector(`[data-photo-caption-index="${activeIndex}"]`);
        if (newActiveInput) {
            newActiveInput.focus();
            try {
                newActiveInput.setSelectionRange(selStart, selEnd);
            } catch (_) {}
        }
    }
}

export function updateActivityPhotoCaption(index, captionText) {
    if (index >= 0 && index < _currentActivityPhotos.length) {
        _currentActivityPhotos[index].caption = String(captionText || '');
    }
}

window.updateActivityPhotoCaption = updateActivityPhotoCaption;

async function processUploadPhotoItem(item, dateVal, employeeName, yearMonth) {
    try {
        item.state = 'uploading';
        item.error = null;
        item.uploadStatusText = 'Mengompresi...';
        renderActivityPhotosGrid();

        if (!item.compressedBase64 && item.file) {
            const compressed = await compressImageToJpegBase64(item.file);
            item.localPreview = compressed.dataUrl;
            item.compressedBase64 = compressed.base64;
        }

        const safeName = item.safeName || `${dateVal}_${employeeName.replace(/[^a-zA-Z0-9]/g, '')}_${Date.now()}_${item.id}.jpg`;
        item.safeName = safeName;
        item.uploadStatusText = 'Mengunggah...';
        renderActivityPhotosGrid();

        const uploaded = await uploadEmployeePhotoToGoogleDrive(
            item.compressedBase64,
            safeName,
            { employeeName, yearMonth },
            3,
            (attempt, maxRetries) => {
                item.uploadStatusText = `Mencoba lagi (${attempt}/${maxRetries})...`;
                renderActivityPhotosGrid();
            }
        );

        item.url = uploaded.url;
        item.fileId = uploaded.fileId;
        item.state = 'ready';
        item.uploadStatusText = '';
        renderActivityPhotosGrid();
    } catch (err) {
        console.warn('[EmployeeAgenda Photo Upload]', err);
        if (err?.code === 'HEIC_UNSUPPORTED') {
            const idx = _currentActivityPhotos.indexOf(item);
            if (idx >= 0) _currentActivityPhotos.splice(idx, 1);
            if (window.showToast) window.showToast('Format Foto Tidak Didukung', err.message, 'warning');
            renderActivityPhotosGrid();
            return;
        }
        item.state = 'failed';
        item.error = err?.message || 'Gagal mengunggah foto';
        item.uploadStatusText = '';
        if (window.showToast) window.showToast('Gagal', `Gagal mengunggah ${item.name}: ${err?.message || 'Kesalahan jaringan'}. Silakan sentuh tombol Coba Lagi pada foto.`, 'error');
        renderActivityPhotosGrid();
    }
}

window.handleActivityPhotoFilesSelected = async function(files) {
    if (!files || files.length === 0) return;
    try {
        const fileArr = Array.from(files);
        const availableSlots = MAX_EMPLOYEE_PHOTOS - _currentActivityPhotos.length;

        if (availableSlots <= 0) {
            if (window.showToast) window.showToast('Peringatan', `Maksimal ${MAX_EMPLOYEE_PHOTOS} foto per kegiatan telah tercapai.`, 'warning');
            return;
        }

        const filesToUpload = fileArr.slice(0, availableSlots);
        if (fileArr.length > availableSlots) {
            if (window.showToast) window.showToast('Informasi', `Hanya ${availableSlots} foto pertama yang dipilih (maksimal ${MAX_EMPLOYEE_PHOTOS} foto).`, 'info');
        }

        const fileInput = document.getElementById('form-activity-photo-input');
        if (fileInput) fileInput.value = '';
        const camInput = document.getElementById('form-activity-photo-camera');
        if (camInput) camInput.value = '';

        const dateVal = document.getElementById('form-activity-date')?.value || selectedDate || formatYMD(new Date());
        const yearMonth = dateVal.slice(0, 7);
        const employeeName = selectedEmployeeName || currentUserName || 'Pegawai';

        for (const file of filesToUpload) {
            if (!file) continue;

            const tempId = ++_activityPhotoUploadSeq;
            const photoItem = {
                id: tempId,
                file,
                name: file.name || `Foto_${tempId}.jpg`,
                state: 'uploading',
                uploadStatusText: 'Mengunggah...',
                localPreview: '',
                compressedBase64: '',
                safeName: '',
                url: '',
                fileId: '',
                error: null
            };
            _currentActivityPhotos.push(photoItem);
            renderActivityPhotosGrid();

            (async (item) => {
                await processUploadPhotoItem(item, dateVal, employeeName, yearMonth);
            })(photoItem);
        }
    } catch (outerErr) {
        console.error('[handleActivityPhotoFilesSelected error]', outerErr);
        if (window.showToast) window.showToast('Gagal', `Gagal memproses foto bukti: ${outerErr?.message || 'Terjadi kesalahan sistem'}`, 'error');
    }
};

window.retryActivityPhoto = async function(index) {
    if (index < 0 || index >= _currentActivityPhotos.length) return;
    const item = _currentActivityPhotos[index];
    if (!item || item.state === 'ready') return;

    const dateVal = document.getElementById('form-activity-date')?.value || selectedDate || formatYMD(new Date());
    const yearMonth = dateVal.slice(0, 7);
    const employeeName = selectedEmployeeName || currentUserName || 'Pegawai';

    if (window.showToast) window.showToast('Memproses', `Mencoba mengunggah ulang ${item.name}...`, 'info');
    await processUploadPhotoItem(item, dateVal, employeeName, yearMonth);
};

window.removeActivityPhoto = function(index) {
    if (index < 0 || index >= _currentActivityPhotos.length) return;
    const item = _currentActivityPhotos[index];
    if (item && item.fileId) {
        deleteEmployeePhotoFromGoogleDrive(item.fileId);
    }
    _currentActivityPhotos.splice(index, 1);
    renderActivityPhotosGrid();
};

window.previewActivityPhotoInModal = function(index) {
    if (index < 0 || index >= _currentActivityPhotos.length) return;
    const readyPhotos = _currentActivityPhotos.filter(p => p.url);
    if (readyPhotos.length > 0) {
        window.openEmployeeLightbox(readyPhotos, index, document.getElementById('form-activity-desc')?.value || 'Foto Bukti Kegiatan');
    }
};

/**
 * Buka Lightbox Galeri Foto Bukti Kegiatan
 */
window.openEmployeeLightbox = function(photosOrActId, initialIndex = 0, title = 'Foto Bukti Kegiatan') {
    let parsedList = [];
    if (typeof photosOrActId === 'string') {
        const foundAct = activitiesList.find(a => String(a.id) === String(photosOrActId)) ||
                         currentWeeklyActivities.find(a => String(a.id) === String(photosOrActId)) ||
                         _supervisorDetailActivitiesMap.get(String(photosOrActId));
        if (foundAct) {
            parsedList = parseEvidencePhotos(foundAct.bukti_url || foundAct.evidence_url);
            title = foundAct.task_item_name || foundAct.task_name || foundAct.description || foundAct.activity_description || title;
        } else {
            parsedList = parseEvidencePhotos(photosOrActId);
        }
    } else if (Array.isArray(photosOrActId)) {
        parsedList = photosOrActId;
    }

    if (!parsedList || parsedList.length === 0) {
        if (window.showToast) window.showToast('Informasi', 'Tidak ada foto bukti yang tersedia untuk kegiatan ini.', 'info');
        return;
    }

    _employeeLightboxPhotos = parsedList;
    _employeeLightboxIndex = Math.max(0, Math.min(initialIndex, parsedList.length - 1));

    const modal = document.getElementById('modal-evidence-lightbox');
    if (!modal) return;

    const titleEl = document.getElementById('lightbox-title');
    if (titleEl) titleEl.textContent = title;

    updateEmployeeLightboxView();
    modal.classList.remove('hidden');

    if (!_employeeLightboxKeyListener) {
        _employeeLightboxKeyListener = (e) => {
            const m = document.getElementById('modal-evidence-lightbox');
            if (!m || m.classList.contains('hidden')) return;
            if (e.key === 'Escape') {
                window.closeEmployeeLightbox();
            } else if (e.key === 'ArrowRight') {
                window.employeeLightboxNext();
            } else if (e.key === 'ArrowLeft') {
                window.employeeLightboxPrev();
            }
        };
        document.addEventListener('keydown', _employeeLightboxKeyListener);
    }

    if (!_employeeLightboxTouchListener) {
        let touchStartX = 0;
        let touchStartY = 0;
        const stage = document.getElementById('lightbox-image-stage') || modal;
        if (stage) {
            stage.addEventListener('touchstart', (e) => {
                if (e.touches && e.touches.length === 1) {
                    touchStartX = e.touches[0].clientX;
                    touchStartY = e.touches[0].clientY;
                }
            }, { passive: true });

            stage.addEventListener('touchend', (e) => {
                if (e.changedTouches && e.changedTouches.length === 1) {
                    const deltaX = e.changedTouches[0].clientX - touchStartX;
                    const deltaY = e.changedTouches[0].clientY - touchStartY;
                    if (Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25) {
                        if (deltaX < 0) {
                            window.employeeLightboxNext();
                        } else {
                            window.employeeLightboxPrev();
                        }
                    }
                }
            }, { passive: true });
            _employeeLightboxTouchListener = true;
        }
    }
};

window.closeEmployeeLightbox = function() {
    const modal = document.getElementById('modal-evidence-lightbox');
    if (modal) modal.classList.add('hidden');
};

window.employeeLightboxNext = function() {
    if (_employeeLightboxPhotos.length <= 1) return;
    _employeeLightboxIndex = (_employeeLightboxIndex + 1) % _employeeLightboxPhotos.length;
    updateEmployeeLightboxView();
};

window.employeeLightboxPrev = function() {
    if (_employeeLightboxPhotos.length <= 1) return;
    _employeeLightboxIndex = (_employeeLightboxIndex - 1 + _employeeLightboxPhotos.length) % _employeeLightboxPhotos.length;
    updateEmployeeLightboxView();
};

function updateEmployeeLightboxView() {
    if (_employeeLightboxPhotos.length === 0) return;
    const cur = _employeeLightboxPhotos[_employeeLightboxIndex] || {};
    const imgEl = document.getElementById('lightbox-img');
    const counterEl = document.getElementById('lightbox-counter');
    const btnDrive = document.getElementById('lightbox-btn-drive');
    const btnPrev = document.getElementById('lightbox-btn-prev');
    const btnNext = document.getElementById('lightbox-btn-next');
    const strip = document.getElementById('lightbox-thumbnails-strip');

    const rawUrl = cur.url || '';
    const fileId = cur.fileId || extractGoogleDriveFileId(rawUrl);
    const displaySrc = fileId
        ? `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}`
        : rawUrl;

    if (imgEl) {
        imgEl.src = displaySrc;
        imgEl.onerror = () => {
            if (displaySrc.includes('lh3.googleusercontent.com') && rawUrl && !rawUrl.includes('lh3.googleusercontent.com')) {
                imgEl.src = rawUrl;
            }
        };
    }
    if (counterEl) {
        counterEl.textContent = `${_employeeLightboxIndex + 1} / ${_employeeLightboxPhotos.length}`;
    }
    if (btnDrive) {
        btnDrive.href = rawUrl || '#';
    }

    const showNav = _employeeLightboxPhotos.length > 1;
    if (btnPrev) btnPrev.classList.toggle('hidden', !showNav);
    if (btnNext) btnNext.classList.toggle('hidden', !showNav);

    if (strip) {
        if (!showNav) {
            strip.classList.add('hidden');
        } else {
            strip.classList.remove('hidden');
            let stripHtml = '';
            _employeeLightboxPhotos.forEach((p, idx) => {
                const isSelected = idx === _employeeLightboxIndex;
                const fId = p.fileId || extractGoogleDriveFileId(p.url || '');
                const thumb = fId ? `https://lh3.googleusercontent.com/d/${fId}=w100` : (p.url || '');
                stripHtml += `
                    <button type="button" onclick="window.setEmployeeLightboxIndex(${idx})" class="w-12 h-9 sm:w-14 sm:h-10 rounded-lg overflow-hidden border-2 transition-all shrink-0 cursor-pointer ${isSelected ? 'border-emerald-500 scale-105 shadow-md' : 'border-slate-700 opacity-60 hover:opacity-100'}">
                        <img src="${thumb}" alt="Thumb ${idx + 1}" class="w-full h-full object-cover pointer-events-none">
                    </button>
                `;
            });
            strip.innerHTML = stripHtml;
        }
    }
}

window.setEmployeeLightboxIndex = function(idx) {
    if (idx >= 0 && idx < _employeeLightboxPhotos.length) {
        _employeeLightboxIndex = idx;
        updateEmployeeLightboxView();
    }
};

// Ekspos helper foto ke window untuk pengujian & konsistensi global
window.MAX_EMPLOYEE_PHOTOS = MAX_EMPLOYEE_PHOTOS;
window.extractGoogleDriveFileId = extractGoogleDriveFileId;
window.getGoogleDriveThumbnail = getGoogleDriveThumbnail;
window.parseEvidencePhotos = parseEvidencePhotos;
window.compressImageToJpegBase64 = compressImageToJpegBase64;
window.uploadEmployeePhotoToGoogleDrive = uploadEmployeePhotoToGoogleDrive;
window.deleteEmployeePhotoFromGoogleDrive = deleteEmployeePhotoFromGoogleDrive;
window.renderActivityPhotosGrid = renderActivityPhotosGrid;
window.reorderActivityPhoto = reorderActivityPhoto;
window.retryActivityPhoto = retryActivityPhoto;

const DEFAULT_TASK_LOCATIONS = {
    'grp_01_keuangan': 'Ruang Tata Usaha (Keuangan)',
    'grp_02_bmd': 'Ruang Sarana Prasarana (BMD)',
    'grp_03_data': 'Ruang Pengelola Data & SIMAS',
    'grp_04_kepegawaian': 'Ruang Kepegawaian (Tata Usaha)',
    'grp_05_kesiswaan': 'Ruang Kesiswaan',
    'grp_06_kurikulum': 'Ruang Kurikulum',
    'grp_07_umum': 'Ruang Tata Usaha',
    'grp_08_perpus': 'Ruang Perpustakaan',
    'grp_09_keamanan': 'Pos Keamanan & Area Sekolah'
};

// 1. Inisialisasi Autentikasi, Layout Navigasi & Hak Akses
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.replace('index.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search + window.location.hash));
        return;
    }

    currentUserUid = user.uid;

    try {
        // Optimasi 0 Read Firestore: Prioritaskan cache lokal
        let role = localStorage.getItem('user_role');
        let name = localStorage.getItem(`cached_user_name_${user.uid}`) || user.displayName || 'Pegawai SIMAS';

        if (!role) {
            try {
                const userSnap = await getDoc(doc(db, 'users', user.uid));
                if (userSnap && userSnap.exists()) {
                    const data = userSnap.data();
                    role = data.role || 'staff';
                    name = data.name || user.displayName || 'Pegawai SIMAS';
                    localStorage.setItem('user_role', role);
                    localStorage.setItem(`cached_user_name_${user.uid}`, name);
                }
            } catch (e) {
                console.warn('[AgendaPegawai] Gagal membaca user doc:', e);
            }
        }

        currentUserRole = role || 'staff';
        currentUserName = name;

        // Inisialisasi Kerangka Layout SIMAS (Sidebar Desktop/Mobile, Header, Profil Pengguna)
        await initLayout(currentUserRole);

        // Multi-Role Support (Super Admin, Kepsek, Tendik/Staff)
        const allRoles = (window.getAllUserRoles ? window.getAllUserRoles() : [currentUserRole]).filter(Boolean);
        isSuperAdmin = allRoles.includes('super_admin') || (window.hasRole && window.hasRole('super_admin')) || (currentUserRole === 'super_admin');
        isKepsek = allRoles.includes('kepala_sekolah') || (window.hasRole && window.hasRole('kepala_sekolah')) || (currentUserRole === 'kepala_sekolah');
        const isStaff = allRoles.includes('staff') || (window.hasRole && window.hasRole('staff')) || (currentUserRole === 'staff');

        // RBAC: Hanya staff, kepala_sekolah, dan super_admin
        if (!isSuperAdmin && !isKepsek && !isStaff) {
            alert('Akses Terbatas: Modul Agenda Pegawai khusus untuk Tenaga Kependidikan (Tendik) dan Pimpinan.');
            window.location.replace('agenda.html');
            return;
        }

        isSupervisor = isSuperAdmin || isKepsek;
        if (isSupervisor) {
            hasEmployeeVipAccess = true;
        }

        // Setup UI Header berdasarkan peran
        const switcherWrapper = document.getElementById('employee-switcher-wrapper');
        const btnSummaryToggle = document.getElementById('btn-monitoring-mode-toggle');
        const inputDate = document.getElementById('input-agenda-date');
        const summaryPanel = document.getElementById('section-employee-summary-view');
        const individualWrapper = document.getElementById('employee-individual-view-wrapper');

        if (inputDate) {
            inputDate.value = selectedDate;
        }
        updateHeaderContext();

        const btnOpenModal = document.getElementById('btn-open-activity-modal');
        const fabWrapper = document.getElementById('fab-open-activity-modal-wrapper');
        const btnManage = document.getElementById('btn-manage-assignments');

        if (isSuperAdmin && !isKepsek) {
            // TIER 3: Super Admin Murni (Murni Supervisi/Monitoring Semua Tendik & Kepala Sekolah, Tanpa Isi Fokus ke Diri Sendiri)
            isMonitoringMode = true;

            // Sembunyikan dropdown header switcher
            if (switcherWrapper) switcherWrapper.classList.add('hidden');

            // Buka langsung panel ringkasan monitoring supervisi
            if (summaryPanel) summaryPanel.classList.remove('hidden');

            // Sembunyikan grid individual awal
            if (individualWrapper) individualWrapper.classList.add('hidden');

            // Sembunyikan tombol toggle "Agenda Saya" karena Super Admin tidak mengisi agenda pribadi
            if (btnSummaryToggle) btnSummaryToggle.classList.add('hidden');

            // Sembunyikan tombol catat aktivitas baru
            if (btnOpenModal) btnOpenModal.classList.add('hidden');
            if (fabWrapper) fabWrapper.classList.add('hidden');

            // Super Admin berwenang mengelola SK Penugasan (tampil di mode monitoring)
            if (btnManage) btnManage.classList.remove('hidden');
            const btnTabVip = document.getElementById('btn-tab-manage-vip');
            if (btnTabVip) btnTabVip.classList.remove('hidden');
            const btnRecap = document.getElementById('btn-employee-monthly-recap-toggle');
            if (btnRecap) {
                btnRecap.classList.add('hidden');
                btnRecap.classList.remove('flex', 'md:flex');
            }

            await loadStaffOptions();
            try {
                const asgRes = await cfClient.getEmployeeAssignments({});
                allAssignmentsList = Array.isArray(asgRes) ? asgRes : (asgRes?.data || []);
            } catch (_) {}

            const mainEl = document.querySelector('main');
            if (mainEl) mainEl.classList.remove('hidden');

            // Muat master SK dan langsung tampilkan Mode Monitoring Pekanan
            await loadMasterSkData();
            if (typeof window.setSummaryMode === 'function') {
                await window.setSummaryMode('weekly');
            } else {
                await loadSupervisorSummary();
            }

        } else if (isKepsek) {
            // TIER 2: Kepala Sekolah (Agenda Kerja Saya Mandiri & Mode Monitoring Supervisi Tendik)
            isMonitoringMode = false;

            if (switcherWrapper) switcherWrapper.classList.add('hidden');
            if (summaryPanel) summaryPanel.classList.add('hidden');
            if (individualWrapper) individualWrapper.classList.remove('hidden');

            if (btnSummaryToggle) {
                btnSummaryToggle.classList.remove('hidden');
                const btnIcon = document.getElementById('btn-monitoring-mode-icon');
                const btnText = document.getElementById('btn-monitoring-mode-text');
                if (btnIcon) btnIcon.className = 'fa-solid fa-chart-line text-amber-400 text-xs';
                if (btnText) btnText.textContent = 'Mode Monitoring';
            }

            if (btnOpenModal) btnOpenModal.classList.remove('hidden');
            if (fabWrapper) fabWrapper.classList.remove('hidden');
            // Mode Agenda Saya: Kelola Penugasan disembunyikan, Rekap Realisasi dimunculkan
            if (btnManage) btnManage.classList.add('hidden');
            const btnRecap = document.getElementById('btn-employee-monthly-recap-toggle');
            if (btnRecap) {
                btnRecap.classList.remove('hidden');
                if (!btnRecap.classList.contains('md:flex')) btnRecap.classList.add('md:flex');
            }

            await loadStaffOptions();
            try {
                const asgRes = await cfClient.getEmployeeAssignments({});
                allAssignmentsList = Array.isArray(asgRes) ? asgRes : (asgRes?.data || []);
            } catch (_) {}

            const mainEl = document.querySelector('main');
            if (mainEl) mainEl.classList.remove('hidden');

            // Muat master SK dan data agenda kerja Kepala Sekolah
            await loadMasterSkData();
            await loadEmployeeDayData();

        } else {
            // TIER 1: Pegawai Biasa / Tendik (Murni Agenda Kerja Saya, Tanpa Mode Monitoring)
            isMonitoringMode = false;

            if (switcherWrapper) switcherWrapper.classList.add('hidden');
            if (btnSummaryToggle) btnSummaryToggle.classList.add('hidden');
            if (summaryPanel) summaryPanel.classList.add('hidden');
            if (individualWrapper) individualWrapper.classList.remove('hidden');

            if (btnOpenModal) btnOpenModal.classList.remove('hidden');
            if (fabWrapper) fabWrapper.classList.remove('hidden');
            if (btnManage) btnManage.classList.add('hidden');

            // Cek hak akses VIP mandiri untuk pegawai tendik
            try {
                const vipRes = await cfClient.getEmployeeVipSettings();
                if (vipRes && vipRes.has_vip_access) {
                    hasEmployeeVipAccess = true;
                }
            } catch (_) {}

            const mainEl = document.querySelector('main');
            if (mainEl) mainEl.classList.remove('hidden');

            await loadMasterSkData();
            await loadEmployeeDayData();
        }

    } catch (err) {
        console.error('[AgendaPegawai] Error inisialisasi:', err);
        const mainEl = document.querySelector('main');
        if (mainEl) mainEl.classList.remove('hidden');
    }
});

// 2. Memuat Daftar Staf untuk Switcher Supervisi (Khusus Kepsek & Super Admin)
async function loadStaffOptions() {
    const select = document.getElementById('select-employee-filter');
    if (!select) return;

    try {
        let staffList = [];

        // Prioritas 1: Ambil dari Cloudflare Summary / Assignments (D1 SSOT daftar tendik resmi)
        try {
            const sumRes = await cfClient.getEmployeeAgendaSummary(selectedDate);
            const dataObj = sumRes?.data || sumRes || {};
            const emps = dataObj.employees || dataObj.all_assigned || [];
            if (Array.isArray(emps) && emps.length > 0) {
                const seen = new Set();
                emps.forEach(e => {
                    const id = e.gtk_id || e.id;
                    const name = e.employee_name || e.name || id;
                    if (id && !seen.has(id)) {
                        seen.add(id);
                        staffList.push({ id, name });
                    }
                });
            }
        } catch (cfErr) {
            console.warn('[AgendaPegawai] Gagal memuat daftar staf dari D1:', cfErr);
        }

        // Prioritas 2: Fallback ke Firestore users jika D1 belum mengembalikan daftar
        if (staffList.length === 0) {
            try {
                const q = query(collection(db, 'users'), where('role', '==', 'staff'));
                const snap = await getDocs(q);
                snap.forEach(d => {
                    staffList.push({ id: d.id, name: d.data().name || d.data().displayName || d.id });
                });
            } catch (fsErr) {
                console.warn('[AgendaPegawai] Gagal fallback Firestore users:', fsErr);
            }
        }

        staffList.sort((a, b) => a.name.localeCompare(b.name));

        const defaultOptionLabel = isSupervisor
            ? '-- Mode Supervisi (Pilih Pegawai) --'
            : `-- Saya Sendiri (${escapeHTML(currentUserName)}) --`;

        select.innerHTML = `<option value="">${defaultOptionLabel}</option>` +
            staffList.map(s => `<option value="${escapeHTML(s.id)}" ${s.id === selectedEmployeeGtkId ? 'selected' : ''}>${escapeHTML(s.name)}</option>`).join('');
    } catch (e) {
        console.warn('[AgendaPegawai] Gagal memuat daftar staf:', e);
    }
}

// 3. Memuat Master Penugasan (Kelompok Tugas & Rincian Butir Tugas)
async function loadMasterSkData() {
    try {
        const res = typeof cfClient.getEmployeeAgendaTasks === 'function'
            ? await cfClient.getEmployeeAgendaTasks()
            : await cfClient.getEmployeeAgendaSk();
        const skData = (res && res.data) ? res.data : res;
        if (skData && Array.isArray(skData.groups)) {
            masterSkData = skData;
            populateActivityGroupOptions();
        }
    } catch (e) {
        console.error('[AgendaPegawai] Gagal memuat data tugas pegawai:', e);
    }
}

function populateActivityGroupOptions() {
    const groupSelect = document.getElementById('form-activity-group');
    if (!groupSelect || !masterSkData || !Array.isArray(masterSkData.groups)) return;

    const currentVal = groupSelect.value;
    const isTargetKs = isCurrentTargetPrincipal();
    const assignedGroupIds = new Set((employeeAssignments || []).map(a => String(a.group_id)));

    let filteredGroups = [];
    if (isTargetKs) {
        // Mode Kepala Sekolah: HANYA kelompok tugas khusus Kepala Sekolah (tanpa butir staf biasa)
        const ksGroups = (masterSkData.groups || []).filter(g => isPrincipalGroup(g));
        filteredGroups = [...ksGroups];
        for (const dg of DEFAULT_PRINCIPAL_GROUPS) {
            if (!filteredGroups.some(g => String(g.kode_kelompok || g.group_code) === String(dg.kode_kelompok))) {
                filteredGroups.push(dg);
            }
        }
        filteredGroups.sort((a, b) => (a.urutan || 99) - (b.urutan || 99));
    } else {
        // Pegawai Biasa: HANYA kelompok tugas staf/tendik biasa (JANGAN munculkan butir Kepala Sekolah)
        filteredGroups = (masterSkData.groups || []).filter(g => !isPrincipalGroup(g));
        filteredGroups.sort((a, b) => {
            const aAssigned = assignedGroupIds.has(String(a.id)) ? 0 : 1;
            const bAssigned = assignedGroupIds.has(String(b.id)) ? 0 : 1;
            if (aAssigned !== bAssigned) return aAssigned - bAssigned;
            return (a.urutan || 99) - (b.urutan || 99);
        });
    }

    groupSelect.innerHTML = '<option value="">-- Pilih Kelompok Penugasan --</option>' +
        filteredGroups.map(g => {
            const isAssigned = assignedGroupIds.has(String(g.id));
            const isKs = isPrincipalGroup(g);
            let rawLabel = g.group_name || g.nama_kelompok || '';
            if (isKs) {
                const parsed = parsePrincipalGroupFields(g);
                rawLabel = parsed.title || rawLabel;
            }
            const label = escapeHTML(rawLabel);
            const prefix = isKs ? '🎓 ' : (isAssigned ? '⭐ ' : '');
            const suffix = isKs ? '' : (isAssigned ? ' (Tugas SK)' : '');
            return `<option value="${g.id}">${prefix}${label}${suffix}</option>`;
        }).join('');

    if (currentVal) {
        groupSelect.value = currentVal;
    }
}

window.onActivityGroupChange = function() {
    const groupSelect = document.getElementById('form-activity-group');
    const taskSelect = document.getElementById('form-activity-task-item');
    const taskItemContainer = document.getElementById('container-form-activity-task-item');
    const principalBadge = document.getElementById('label-principal-task-badge');
    const quickManageBtn = document.getElementById('btn-quick-manage-principal-tasks');
    const principalDescContainer = document.getElementById('container-principal-task-description');
    const principalDescText = document.getElementById('text-principal-task-description');
    const roleInput = document.getElementById('form-activity-role');
    const roleBadge = document.getElementById('form-activity-role-badge');
    const locInput = document.getElementById('form-activity-location');
    if (!groupSelect || !masterSkData) return;

    const groupId = groupSelect.value;
    const selectedGroup = (masterSkData.groups || []).find(g => String(g.id) === String(groupId)) ||
        DEFAULT_PRINCIPAL_GROUPS.find(g => String(g.id) === String(groupId) || String(g.kode_kelompok) === String(groupId));
    const isPrincipal = isPrincipalGroup(selectedGroup) || isCurrentTargetPrincipal();

    // Kontrol Tampilan Khusus Kepala Sekolah (Permendikdasmen 23/2026):
    // Cukup memilih Butir Utama saja, langsung mengisi uraian dan foto tanpa butir rincian tugas
    if (principalBadge) {
        if (isPrincipal) principalBadge.classList.remove('hidden');
        else principalBadge.classList.add('hidden');
    }
    // Tombol pengaturan kelola butir penugasan di dalam modal ditiadakan karena sudah dikelola di tombol header
    if (quickManageBtn) {
        quickManageBtn.classList.add('hidden');
    }

    // Tampilkan Uraian Butir Tugas Pokok Kepala Sekolah secara otomatis di bawah dropdown
    if (principalDescContainer && principalDescText) {
        if (isPrincipal && selectedGroup) {
            const { desc } = parsePrincipalGroupFields(selectedGroup);
            if (desc) {
                principalDescText.textContent = desc;
                principalDescContainer.classList.remove('hidden');
            } else {
                principalDescText.textContent = '';
                principalDescContainer.classList.add('hidden');
            }
        } else {
            principalDescText.textContent = '';
            principalDescContainer.classList.add('hidden');
        }
    }

    if (taskItemContainer) {
        if (isPrincipal) {
            taskItemContainer.classList.add('hidden');
            if (taskSelect) {
                taskSelect.required = false;
                taskSelect.value = groupId || 'ks-main-task';
            }
        } else {
            taskItemContainer.classList.remove('hidden');
            if (taskSelect) {
                taskSelect.required = true;
            }
        }
    }

    // 1. Update Info Peran Pegawai sesuai master data penugasan
    if (roleInput) {
        if (!groupId) {
            roleInput.value = '';
            if (roleBadge) {
                roleBadge.innerHTML = '<i class="fa-solid fa-circle-info text-slate-400"></i> Pilih Kelompok';
                roleBadge.className = 'text-[10px] font-medium text-slate-400 flex items-center gap-1';
            }
        } else if (isPrincipal) {
            roleInput.value = 'Kepala Sekolah (Tugas Pokok Manajerial & Supervisi)';
            if (roleBadge) {
                roleBadge.innerHTML = '<i class="fa-solid fa-graduation-cap text-amber-500"></i> Permendikdasmen 23/2026';
                roleBadge.className = 'text-[10px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1';
            }
        } else {
            let matchingAsg = (employeeAssignments || []).find(a => String(a.group_id) === String(groupId));
            if (!matchingAsg && isSupervisor && selectedEmployeeGtkId && Array.isArray(allAssignmentsList)) {
                matchingAsg = allAssignmentsList.find(a => 
                    String(a.group_id) === String(groupId) && 
                    (String(a.gtk_id) === String(selectedEmployeeGtkId) || 
                     String(a.id) === String(selectedEmployeeGtkId) ||
                     (selectedEmployeeName && String(a.employee_name).toLowerCase().includes(selectedEmployeeName.toLowerCase())))
                );
            }

            if (matchingAsg && (matchingAsg.role_title || matchingAsg.peran_rincian)) {
                const title = matchingAsg.role_title || matchingAsg.peran_rincian;
                const asst = matchingAsg.is_assistant ? ' (Pembantu)' : '';
                roleInput.value = `${title}${asst}`;
                if (roleBadge) {
                    roleBadge.innerHTML = '<i class="fa-solid fa-circle-check text-emerald-500"></i> Sesuai SK Penugasan';
                    roleBadge.className = 'text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1';
                }
            } else {
                roleInput.value = 'Tugas Pokok Umum / Non-Spesifik';
                if (roleBadge) {
                    roleBadge.innerHTML = '<i class="fa-solid fa-circle-info text-slate-400"></i> Tugas Umum';
                    roleBadge.className = 'text-[10px] font-medium text-slate-400 flex items-center gap-1';
                }
            }
        }
    }

    // 2. Lokasi Pelaksanaan: Tendik default "Ruang Tata Usaha", sedangkan Kepala Sekolah dibiarkan kosong agar diisi mandiri
    if (locInput && !locInput.value.trim() && !isPrincipal) {
        locInput.value = 'Ruang Tata Usaha';
    }

    if (!taskSelect) return;

    if (isPrincipal) {
        taskSelect.innerHTML = `<option value="${escapeHTML(groupId || 'ks-main-task')}">[Tugas Pokok] Sesuai Butir Utama Kepala Sekolah</option>`;
        taskSelect.value = groupId || 'ks-main-task';
        return;
    }

    if (!groupId) {
        taskSelect.innerHTML = '<option value="">-- Pilih Butir Rincian Tugas --</option>';
        return;
    }

    const items = (masterSkData.task_items || masterSkData.items || []).filter(item => String(item.group_id) === String(groupId));
    taskSelect.innerHTML = '<option value="">-- Pilih Butir Rincian Tugas --</option>' +
        items.map(it => `<option value="${it.id}">[${it.item_code || it.task_code || '-'}] ${escapeHTML(it.item_name || it.task_name || '')}</option>`).join('');

    // Otomatis pilih butir tugas pertama jika pencatatan baru
    if (!editingActivityId && items.length > 0 && !taskSelect.value) {
        taskSelect.value = items[0].id;
    }
};

// 3.5 Helper Tanggal & Kendali Format Pekan (SSOT Senin s.d. Jumat & Target 37,5 Jam)
const INDO_DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const INDO_MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function getMondayDate(dateStr) {
    const parts = dateStr.split('-');
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d);
    monday.setDate(diff);
    const year = monday.getFullYear();
    const month = String(monday.getMonth() + 1).padStart(2, '0');
    const date = String(monday.getDate()).padStart(2, '0');
    return `${year}-${month}-${date}`;
}

function getWorkWeekDays(dateStr) {
    const mondayStr = getMondayDate(dateStr);
    const days = [];
    const parts = mondayStr.split('-');
    const mDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    for (let i = 0; i < 5; i++) {
        const cur = new Date(mDate);
        cur.setDate(mDate.getDate() + i);
        const y = cur.getFullYear();
        const m = String(cur.getMonth() + 1).padStart(2, '0');
        const d = String(cur.getDate()).padStart(2, '0');
        days.push(`${y}-${m}-${d}`);
    }
    return days;
}

function formatIndonesianDateFull(dateStr) {
    if (!dateStr) return '-';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(d.getTime())) return dateStr;
    const dayName = INDO_DAYS[d.getDay()] || '';
    const dayNum = parts[2];
    const monthName = INDO_MONTHS_SHORT[d.getMonth()] || '';
    const year = parts[0];
    return `${dayName}, ${dayNum} ${monthName} ${year}`;
}

function formatIndonesianDayDateCompact(dateStr) {
    if (!dateStr) return '-';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(d.getTime())) return dateStr;
    const dayName = INDO_DAYS[d.getDay()] || '';
    const dayNum = parts[2];
    const monthName = INDO_MONTHS_SHORT[d.getMonth()] || '';
    return `${dayName}, ${dayNum} ${monthName}`;
}

function formatWeekRange(mondayStr, fridayStr) {
    if (!mondayStr || !fridayStr) return '-';
    const mParts = mondayStr.split('-');
    const fParts = fridayStr.split('-');
    if (mParts.length !== 3 || fParts.length !== 3) return `${mondayStr} s.d. ${fridayStr}`;

    const mD = mParts[2];
    const fD = fParts[2];
    const mM = Number(mParts[1]) - 1;
    const fM = Number(fParts[1]) - 1;
    const mY = Number(mParts[0]);
    const fY = Number(fParts[0]);

    const mMonth = INDO_MONTHS_SHORT[mM] || '';
    const fMonth = INDO_MONTHS_SHORT[fM] || '';

    if (mY === fY) {
        if (mM === fM) {
            return `Pekan: ${mD} – ${fD} ${mMonth} ${mY}`;
        }
        return `Pekan: ${mD} ${mMonth} – ${fD} ${fMonth} ${mY}`;
    }
    return `Pekan: ${mD} ${mMonth} ${mY} – ${fD} ${fMonth} ${fY}`;
}

export function updateHeaderModeButtons() {
    const isPersonalMode = !isSupervisor || !isMonitoringMode;
    const btnRecap = document.getElementById('btn-employee-monthly-recap-toggle');
    const btnManage = document.getElementById('btn-manage-assignments');

    // Tombol Rekap Realisasi: HANYA muncul pada mode Agenda Saya, disembunyikan di Mode Monitoring
    if (btnRecap) {
        if (isPersonalMode) {
            btnRecap.classList.remove('hidden');
            if (!btnRecap.classList.contains('md:flex')) btnRecap.classList.add('md:flex');
        } else {
            btnRecap.classList.add('hidden');
            btnRecap.classList.remove('md:flex');
        }
    }

    // Tombol Kelola Penugasan: Disembunyikan pada mode Agenda Saya, dimunculkan pada Mode Monitoring (khusus supervisor)
    if (btnManage) {
        if (!isPersonalMode && isSupervisor) {
            btnManage.classList.remove('hidden');
        } else {
            btnManage.classList.add('hidden');
        }
    }
}
window.updateHeaderModeButtons = updateHeaderModeButtons;

export function updateHeaderContext() {
    const isPersonalMode = !isSupervisor || !isMonitoringMode;
    const titleEl = document.getElementById('page-title-text');
    if (titleEl) {
        titleEl.textContent = 'E-Kinerja Tenaga Kependidikan';
    }
    const userNameEl = document.getElementById('header-user-name');
    if (userNameEl) {
        let targetName = currentUserName;
        if (isPersonalMode) {
            targetName = currentUserName || (isCurrentTargetPrincipal() ? 'Kepala Sekolah' : 'Pegawai SIMAS');
        } else {
            targetName = 'Mode Monitoring';
        }
        userNameEl.textContent = targetName || currentUserName || 'Pegawai SIMAS';
    }
    const dateDisplayEl = document.getElementById('header-date-display');
    if (dateDisplayEl) {
        dateDisplayEl.textContent = formatIndonesianDateFull(selectedDate);
    }
    const weekLabelEl = document.getElementById('header-week-label');
    if (weekLabelEl) {
        const weekDays = getWorkWeekDays(selectedDate);
        weekLabelEl.textContent = formatWeekRange(weekDays[0], weekDays[4]);
    }
    updateHeaderModeButtons();
}
window.updateHeaderContext = updateHeaderContext;

// 4. Memuat Data Harian Pegawai (Aktivitas & SK Penugasan Aktif)
let _dayLoadSeq = 0;
let _weekLoadSeq = 0;

async function loadEmployeeDayData() {
    const mySeq = ++_dayLoadSeq;
    const requestedDate = selectedDate;
    const isPersonalMode = !isSupervisor || !isMonitoringMode;
    const targetGtkId = isPersonalMode ? '' : (selectedEmployeeGtkId || '');
    const targetName = isPersonalMode
        ? (currentUserName || (isCurrentTargetPrincipal() ? 'Kepala Sekolah' : 'Pegawai SIMAS'))
        : (selectedEmployeeName || (selectedEmployeeGtkId ? 'Pegawai Terpilih' : 'Mode Monitoring (Seluruh Tendik)'));

    const skNameEl = document.getElementById('sk-assignment-employee-name');
    if (skNameEl) {
        skNameEl.textContent = targetName;
    }

    // Perbarui seluruh konteks teks header (User name, active date, week range)
    updateHeaderContext();

    // Set tanggal formulir input default
    const formDate = document.getElementById('form-activity-date');
    if (formDate && !formDate.value) {
        formDate.value = selectedDate;
    }

    // Proteksi tombol Catat Aktivitas:
    // Jika isPersonalMode: WAJIB DITAMPILKAN (karena Kepsek atau Staf sedang mencatat kinerjanya sendiri)
    // Jika mode monitoring (baik tampilan awal maupun sedang inspeksi staf lain): sembunyikan
    const btnOpenModal = document.getElementById('btn-open-activity-modal');
    const fabWrapper = document.getElementById('fab-open-activity-modal-wrapper');
    if (isPersonalMode) {
        if (btnOpenModal) btnOpenModal.classList.remove('hidden');
        if (fabWrapper) fabWrapper.classList.remove('hidden');
    } else {
        if (btnOpenModal) btnOpenModal.classList.add('hidden');
        if (fabWrapper) fabWrapper.classList.add('hidden');
    }

    // Muat penugasan SK pegawai
    await loadEmployeeAssignments(targetGtkId);
    if (mySeq !== _dayLoadSeq) return;

    // Muat aktivitas harian dari D1 via Cloudflare Client
    const activitiesContainer = document.getElementById('employee-activities-container');
    if (activitiesContainer) {
        activitiesContainer.innerHTML = `
            <div class="col-span-full text-center py-12 opacity-40">
                <i class="fa-solid fa-spinner fa-spin text-3xl mb-2 text-emerald-500"></i>
                <p class="text-xs font-bold uppercase tracking-widest text-slate-500">Memuat Log Aktivitas...</p>
            </div>
        `;
    }

    try {
        const queryParams = { date: requestedDate };
        if (isPersonalMode) {
            queryParams.mode = 'personal';
            queryParams.self = 'true';
        } else if (targetGtkId) {
            queryParams.gtk_id = targetGtkId;
        }

        const [actOutcome, absOutcome] = await Promise.allSettled([
            cfClient.getEmployeeActivities(queryParams),
            cfClient.getEmployeeAbsences(queryParams)
        ]);
        if (mySeq !== _dayLoadSeq) return;

        if (actOutcome.status === 'fulfilled') {
            const res = actOutcome.value;
            const dataArr = res?.data || (Array.isArray(res) ? res : []);
            activitiesList = Array.isArray(dataArr) ? dataArr : [];
        } else {
            console.error('[AgendaPegawai] Gagal memuat aktivitas:', actOutcome.reason);
            activitiesList = [];
        }

        // Muat data ketidakhadiran harian (Sakit / Cuti / Izin)
        if (absOutcome.status === 'fulfilled') {
            const absRes = absOutcome.value;
            const absArr = absRes?.data || (Array.isArray(absRes) ? absRes : []);
            currentDayAbsence = (Array.isArray(absArr) && absArr.length > 0) ? absArr[0] : null;
        } else {
            console.warn('[loadEmployeeDayData] Gagal memuat ketidakhadiran:', absOutcome.reason);
            currentDayAbsence = null;
        }
    } catch (e) {
        console.error('[AgendaPegawai] Gagal memuat aktivitas:', e);
        activitiesList = [];
        currentDayAbsence = null;
    }

    // Pastikan cache hari libur agenda terisi untuk pekan ini
    try {
        const weekDays = getWorkWeekDays(requestedDate);
        if (typeof fetchAgendaHolidaysForRange === 'function') {
            await fetchAgendaHolidaysForRange(weekDays[0], weekDays[4]);
        }
    } catch (eH) {
        console.warn('[loadEmployeeDayData] Gagal memuat data hari libur agenda:', eH);
    }
    if (mySeq !== _dayLoadSeq) return;

    // Render Dashboard Jam Kerja, Ribbon Timeline, dan Daftar Aktivitas
    renderWorkHoursDashboard();
    window.renderEmployeeActivities();
    loadEmployeeWeeklyData();
}

// 5. Memuat SK Penugasan Pegawai
async function loadEmployeeAssignments(targetGtkId) {
    const badgesContainer = document.getElementById('sk-assignment-badges');
    if (!badgesContainer) return;

    const isPersonalMode = !isSupervisor || !isMonitoringMode;
    const isPrincipal = isPersonalMode && isCurrentTargetPrincipal();

    const labelTextEl = document.getElementById('sk-assignment-label-text');
    const btnToggleSk = document.getElementById('btn-toggle-sk-details');
    const sectionSkDetails = document.getElementById('section-sk-details');
    const iconWrapper = document.getElementById('sk-assignment-icon-wrapper');
    const iconEl = document.getElementById('sk-assignment-icon');

    // Pengaturan Tampilan Penugasan: Kepala Sekolah (Tugas Pokok Regulasi) vs Pegawai Tendik (Penugasan SK)
    if (isPrincipal) {
        if (labelTextEl) labelTextEl.textContent = 'Tugas Pokok:';
        if (btnToggleSk) btnToggleSk.classList.add('hidden');
        if (sectionSkDetails) sectionSkDetails.classList.add('hidden');
        if (iconWrapper) {
            iconWrapper.className = 'w-6 h-6 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xs shrink-0';
        }
        if (iconEl) {
            iconEl.className = 'fa-solid fa-graduation-cap text-[11px]';
        }
    } else {
        if (labelTextEl) labelTextEl.textContent = 'Penugasan SK:';
        if (btnToggleSk) btnToggleSk.classList.remove('hidden');
        if (iconWrapper) {
            iconWrapper.className = 'w-6 h-6 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xs shrink-0';
        }
        if (iconEl) {
            iconEl.className = 'fa-solid fa-file-contract text-[11px]';
        }
    }

    try {
        let res = null;
        if (!isPersonalMode && targetGtkId) {
            res = await cfClient.getEmployeeAssignments({ gtk_id: targetGtkId });
            let list = Array.isArray(res) ? res : (res?.data || []);
            // Fallback cari berdasarkan nama jika pencarian ID kosong
            if ((!list || list.length === 0) && selectedEmployeeName) {
                res = await cfClient.getEmployeeAssignments({ gtk_id: selectedEmployeeName });
                list = Array.isArray(res) ? res : (res?.data || []);
            }
            // Fallback dari allAssignmentsList yang sudah di-cache
            if ((!list || list.length === 0) && Array.isArray(allAssignmentsList) && allAssignmentsList.length > 0) {
                const localMatches = allAssignmentsList.filter(a => 
                    String(a.gtk_id) === String(targetGtkId) || 
                    String(a.id) === String(targetGtkId) ||
                    (selectedEmployeeName && String(a.employee_name).toLowerCase().includes(selectedEmployeeName.toLowerCase()))
                );
                if (localMatches.length > 0) list = localMatches;
            }
            employeeAssignments = list || [];
        } else if (isPersonalMode) {
            res = await cfClient.getMyAssignments();
            let list = Array.isArray(res) ? res : (res?.data || []);
            if ((!list || list.length === 0) && currentUserName) {
                res = await cfClient.getEmployeeAssignments({ gtk_id: currentUserName });
                list = Array.isArray(res) ? res : (res?.data || []);
            }
            employeeAssignments = list || [];

            // Jika belum ada pemetaan SK khusus dan target adalah Kepala Sekolah, tampilkan tugas pokok resmi KS
            if ((!employeeAssignments || employeeAssignments.length === 0) && isCurrentTargetPrincipal()) {
                badgesContainer.innerHTML = `
                    <div class="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/60 rounded-xl border border-emerald-200 dark:border-emerald-800/70 text-xs flex items-center gap-1.5">
                        <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                        <span class="font-bold text-emerald-800 dark:text-emerald-300">Tugas Pokok Kepala Sekolah</span>
                        <span class="text-slate-400 dark:text-slate-500">(Permendikdasmen No. 23/2026)</span>
                        <span class="px-1.5 py-0.2 bg-emerald-600 text-white rounded text-[9px] font-black uppercase ml-1">Utama</span>
                    </div>
                `;
                populateActivityGroupOptions();
                return;
            }
        } else {
            // Mode Monitoring aktif tanpa pegawai terpilih
            employeeAssignments = [];
            badgesContainer.innerHTML = `
                <div class="text-xs text-slate-400 italic">
                    Pilih salah satu pegawai pada switcher di atas atau tabel supervisi untuk melihat penugasan SK resmi.
                </div>
            `;
            return;
        }

        if (employeeAssignments && employeeAssignments.length > 0) {
            badgesContainer.innerHTML = employeeAssignments.map(a => {
                const groupName = escapeHTML(a.group_name || 'Tugas Pokok');
                const roleTitle = escapeHTML(a.role_title || 'Pelaksana');
                const isPrimary = a.is_primary ? '<span class="px-1.5 py-0.2 bg-emerald-600 text-white rounded text-[9px] font-black uppercase ml-1">Utama</span>' : '';
                return `
                    <div class="px-3 py-1.5 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-200/80 dark:border-slate-700 text-xs flex items-center gap-1.5">
                        <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                        <span class="font-bold text-slate-800 dark:text-white">${groupName}</span>
                        <span class="text-slate-400">(${roleTitle})</span>
                        ${isPrimary}
                    </div>
                `;
            }).join('');
        } else {
            badgesContainer.innerHTML = `
                <div class="text-xs text-slate-400 italic">
                    Belum ada pemetaan SK khusus. Berlaku tugas pokok tenaga kependidikan umum.
                </div>
            `;
        }
        populateActivityGroupOptions();
    } catch (e) {
        console.warn('[AgendaPegawai] Gagal memuat penugasan SK:', e);
        badgesContainer.innerHTML = '<div class="text-xs text-slate-400 italic">Gagal memuat penugasan SK.</div>';
    }
}

/**
 * Toggle Buka/Tutup Rincian Surat Keputusan (SK) Penugasan Pegawai
 */
window.toggleSkDetails = function() {
    // Kepala Sekolah tidak menggunakan SK penugasan (tupoksi langsung dari regulasi Permendikdasmen 23/2026)
    const isPersonalMode = !isSupervisor || !isMonitoringMode;
    if (isPersonalMode && isCurrentTargetPrincipal()) return;

    const section = document.getElementById('section-sk-details');
    const icon = document.getElementById('icon-sk-details');
    if (!section) return;

    const isHidden = section.classList.toggle('hidden');
    if (icon) {
        if (isHidden) {
            icon.classList.remove('rotate-180');
        } else {
            icon.classList.add('rotate-180');
        }
    }
};

/**
 * Memeriksa apakah waktu kegiatan telah selesai berdasarkan waktu sekarang (WITA UTC+8)
 */
function isActivityTimeCompleted(activityDate, endTime) {
    if (!activityDate || !endTime) return false;
    const now = new Date();
    const witaOffset = 8 * 60;
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const nowWita = new Date(utc + (witaOffset * 60000));

    const yyyy = nowWita.getFullYear();
    const mm = String(nowWita.getMonth() + 1).padStart(2, '0');
    const dd = String(nowWita.getDate()).padStart(2, '0');
    const todayWita = `${yyyy}-${mm}-${dd}`;

    if (activityDate > todayWita) return false;
    if (activityDate < todayWita) return true;

    const nowHours = String(nowWita.getHours()).padStart(2, '0');
    const nowMinutes = String(nowWita.getMinutes()).padStart(2, '0');
    const nowTimeStr = `${nowHours}:${nowMinutes}`;

    return endTime <= nowTimeStr;
}
window.isActivityTimeCompleted = isActivityTimeCompleted;

const SUPERVISOR_READONLY_MSG = 'Realisasi kegiatan hanya dapat diisi oleh pegawai yang bersangkutan.';

function isSupervisorViewingOthers() {
    return isSupervisor && isMonitoringMode;
}

/**
 * Memperbarui label & status tombol simpan (Draf vs Realisasi) secara reaktif
 */
function updateModalSaveButtonState() {
    const dateVal = document.getElementById('form-activity-date')?.value;
    const endVal = document.getElementById('form-activity-end')?.value;
    const indicatorEl = document.getElementById('modal-activity-status-indicator');
    const iconEl = document.getElementById('modal-activity-status-icon');
    const textEl = document.getElementById('modal-activity-status-text');
    const btnSave = document.getElementById('btn-save-activity');
    const btnLabel = document.getElementById('btn-save-activity-label');
    const btnIcon = document.getElementById('btn-save-activity-icon');
    const btnDraftAlt = document.getElementById('btn-save-draft-alt');

    if (!indicatorEl || !btnSave) return;

    const isCompleted = isActivityTimeCompleted(dateVal, endVal);

    if (!isCompleted) {
        indicatorEl.className = 'p-2 sm:p-2.5 rounded-xl text-xs flex items-center justify-between gap-2 border bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-200 transition-all';
        if (iconEl) iconEl.className = 'fa-solid fa-hourglass-half text-amber-500 shrink-0';
        if (textEl) textEl.textContent = 'Waktu kegiatan belum selesai. Aktivitas akan disimpan sebagai Draf (belum terhitung realisasi).';
        if (btnLabel) btnLabel.textContent = 'Simpan Draf';
        if (btnIcon) btnIcon.className = 'fa-solid fa-floppy-disk';
        btnSave.className = 'px-4 py-2 sm:py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-lg transition-all active:scale-95 flex items-center gap-2 cursor-pointer';
        if (btnDraftAlt) btnDraftAlt.classList.add('hidden');
    } else {
        indicatorEl.className = 'p-2 sm:p-2.5 rounded-xl text-xs flex items-center justify-between gap-2 border bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-200 transition-all';
        if (iconEl) iconEl.className = 'fa-solid fa-circle-check text-emerald-500 shrink-0';
        if (textEl) textEl.textContent = 'Waktu kegiatan telah selesai. Aktivitas akan disimpan sebagai Realisasi resmi jam kerja.';
        if (btnLabel) btnLabel.textContent = 'Simpan Realisasi';
        if (btnIcon) btnIcon.className = 'fa-solid fa-save';
        btnSave.className = 'px-4 py-2 sm:py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-500/20 transition-all active:scale-95 flex items-center gap-2 cursor-pointer';
        if (btnDraftAlt) btnDraftAlt.classList.remove('hidden');
    }

    // Pimpinan dalam mode monitoring hanya memantau; realisasi diisi oleh pegawai yang bersangkutan
    const isReadOnly = isSupervisorViewingOthers();
    [btnSave, btnDraftAlt].forEach(btn => {
        if (!btn) return;
        btn.disabled = isReadOnly;
        btn.classList.toggle('opacity-50', isReadOnly);
        btn.classList.toggle('cursor-not-allowed', isReadOnly);
        btn.classList.toggle('cursor-pointer', !isReadOnly);
        if (isReadOnly) {
            if (btn.dataset.originalTitle === undefined) btn.dataset.originalTitle = btn.title || '';
            btn.title = SUPERVISOR_READONLY_MSG;
        } else if (btn.dataset.originalTitle !== undefined) {
            btn.title = btn.dataset.originalTitle;
            delete btn.dataset.originalTitle;
        }
    });
}
window.updateModalSaveButtonState = updateModalSaveButtonState;

/**
 * Aksi cepat merealisasikan draf kegiatan setelah jam selesai tiba
 */
window.finalizeEmployeeActivity = async function(id) {
    const act = activitiesList.find(a => String(a.id) === String(id));
    if (!act) return;
    if (isSupervisorViewingOthers()) {
        if (window.showToast) window.showToast('Akses Dibatasi', SUPERVISOR_READONLY_MSG, 'warning');
        return;
    }

    const ok = await showConfirmModal(
        `Realisasikan aktivitas "${escapeHTML(act.description || act.uraian_kegiatan || 'Aktivitas')}"? Kegiatan ini akan resmi terhitung ke jam kerja.`,
        'Realisasikan Kegiatan',
        'info'
    );
    if (!ok) return;

    try {
        const payload = {
            action: 'update_status',
            status: 'submitted'
        };
        const res = await cfClient.updateEmployeeActivity(id, payload);
        if (res && res.success) {
            if (window.showToast) window.showToast('Berhasil Direalisasikan', 'Aktivitas berhasil dicatat ke realisasi jam kerja resmi.', 'success');
            await loadEmployeeDayData();
        } else {
            throw new Error(res?.error || 'Gagal merealisasikan aktivitas');
        }
    } catch (e) {
        console.error('[finalizeEmployeeActivity] Error:', e);
        if (window.showToast) window.showToast('Gagal', e.message || 'Gagal merealisasikan aktivitas.', 'error');
    }
};

// 6. Kalkulasi & Render Dashboard Jam Kerja Efektif (Target 450 Menit)
function renderWorkHoursDashboard() {
    let totalEffectiveMinutes = 0;
    let totalDraftMinutes = 0;

    activitiesList.forEach(act => {
        const eff = calculateEffectiveMinutes(act.start_time, act.end_time);
        if (act.status === 'draft') {
            totalDraftMinutes += eff;
        } else {
            totalEffectiveMinutes += eff;
        }
    });

    const statMinEl = document.getElementById('stat-effective-minutes');
    const statHoursEl = document.getElementById('stat-effective-hours');
    const progressBar = document.getElementById('bar-effective-progress');
    const percentLabel = document.getElementById('label-effective-percent');
    const statusBadge = document.getElementById('badge-effective-status');
    const holidayBanner = document.getElementById('employee-holiday-banner');
    const holidayBannerText = document.getElementById('employee-holiday-banner-text');

    const TARGET_MINUTES = 450; // 7.5 jam efektif
    const hoursVal = (totalEffectiveMinutes / 60).toFixed(1);
    const percentVal = Math.min(100, Math.round((totalEffectiveMinutes / TARGET_MINUTES) * 100));

    if (statMinEl) statMinEl.textContent = `${totalEffectiveMinutes} Menit`;
    if (statHoursEl) {
        const draftNote = totalDraftMinutes > 0 ? ` (+ ${totalDraftMinutes}m Draf)` : '';
        statHoursEl.textContent = `/ ${hoursVal} Jam${draftNote}`;
    }
    if (percentLabel) percentLabel.textContent = `${percentVal}%`;
    if (progressBar) progressBar.style.width = `${percentVal}%`;

    const dateObj = new Date(selectedDate + "T00:00:00");
    const dayOfWeek = isNaN(dateObj.getDay()) ? -1 : dateObj.getDay();
    const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
    const agendaHoliday = (typeof getAgendaHolidayForDate === 'function') ? getAgendaHolidayForDate(selectedDate) : null;
    const isHoliday = Boolean(agendaHoliday);

    // Penyesuaian metrik jam harian jika bertepatan dengan hari libur resmi (target harian 0 jam)
    if (isHoliday) {
        if (totalEffectiveMinutes > 0) {
            if (percentLabel) percentLabel.textContent = `+${hoursVal}j (Surplus)`;
            if (statHoursEl) {
                const draftNote = totalDraftMinutes > 0 ? ` (+ ${totalDraftMinutes}m Draf)` : '';
                statHoursEl.textContent = `/ +${hoursVal} Jam (Surplus)${draftNote}`;
            }
            if (progressBar) progressBar.style.width = '100%';
        } else {
            if (percentLabel) percentLabel.textContent = 'Libur Resmi';
            if (statHoursEl) {
                const draftNote = totalDraftMinutes > 0 ? ` (+ ${totalDraftMinutes}m Draf)` : '';
                statHoursEl.textContent = `/ 0 Jam (Libur)${draftNote}`;
            }
            if (progressBar) progressBar.style.width = '100%';
        }
    }

    // Sinkronisasi Banner Hari Libur Agenda
    if (holidayBanner && holidayBannerText) {
        if (isHoliday && !isSupervisor) {
            holidayBanner.classList.remove('hidden');
            holidayBannerText.innerHTML = `<strong>Hari Libur Agenda (${escapeHTML(agendaHoliday.title || 'Libur Resmi')}):</strong> Hari ini merupakan hari libur kalender agenda. Target jam kerja harian otomatis disesuaikan (0 menit) dan target mingguan dikurangi 7,5 jam. Anda tidak diwajibkan mencatat aktivitas kecuali memiliki tugas khusus.`;
        } else {
            holidayBanner.classList.add('hidden');
        }
    }

    if (statusBadge) {
        if (isWeekend) {
            if (totalEffectiveMinutes > 0) {
                statusBadge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800";
                statusBadge.textContent = `Aktivitas Akhir Pekan (${totalEffectiveMinutes}m)`;
            } else {
                statusBadge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800";
                statusBadge.textContent = "Libur Akhir Pekan";
            }
        } else if (isHoliday) {
            if (totalEffectiveMinutes > 0) {
                statusBadge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800";
                statusBadge.textContent = `Libur Agenda - Ada Kegiatan (${totalEffectiveMinutes}m)`;
            } else {
                statusBadge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800";
                statusBadge.textContent = `Libur: ${escapeHTML(agendaHoliday.title || 'Agenda')}`;
            }
        } else if (currentDayAbsence) {
            statusBadge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-800";
            statusBadge.textContent = `${currentDayAbsence.jenis}: Sah (0m)`;
        } else if (totalEffectiveMinutes >= TARGET_MINUTES) {
            statusBadge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800";
            statusBadge.textContent = "Target Tercapai (450m)";
        } else if (totalEffectiveMinutes > 0) {
            const diff = TARGET_MINUTES - totalEffectiveMinutes;
            statusBadge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800";
            statusBadge.textContent = `Kurang ${diff} Menit`;
        } else if (totalDraftMinutes > 0) {
            statusBadge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800";
            statusBadge.textContent = `Draf Berjalan (${totalDraftMinutes}m)`;
        } else {
            statusBadge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-500";
            statusBadge.textContent = "Belum Ada Aktivitas";
        }
    }

    // Sinkronisasi Panel Status Ketidakhadiran Harian (Sakit / Cuti / Izin)
    const panelEmpty = document.getElementById('panel-absence-empty');
    const panelActive = document.getElementById('panel-absence-active');
    const absenceTitle = document.getElementById('absence-active-title');
    const absenceNotes = document.getElementById('absence-active-notes');
    const absenceIcon = document.getElementById('absence-active-icon');

    if (currentDayAbsence) {
        if (panelEmpty) panelEmpty.classList.add('hidden');
        if (panelActive) panelActive.classList.remove('hidden');
        if (absenceTitle) absenceTitle.textContent = `Tidak Melaksanakan Tugas: ${currentDayAbsence.jenis}`;
        if (absenceNotes) absenceNotes.textContent = currentDayAbsence.alasan || 'Keterangan resmi tercatat';
        if (absenceIcon) {
            absenceIcon.className = currentDayAbsence.jenis === 'Sakit'
                ? 'fa-solid fa-hospital-user'
                : (currentDayAbsence.jenis === 'Cuti' ? 'fa-solid fa-plane-departure' : 'fa-solid fa-clipboard-user');
        }
    } else {
        if (panelEmpty) panelEmpty.classList.remove('hidden');
        if (panelActive) panelActive.classList.add('hidden');
    }

    renderVisualTimelineRibbon();
}

// 7. Visual Ribbon Timeline (07:30 - 15:30 = 480 menit bruto)
function renderVisualTimelineRibbon() {
    const ribbon = document.getElementById('timeline-work-ribbon');
    const gapEl = document.getElementById('stat-gap-summary');
    if (!ribbon) return;

    const agendaHoliday = (typeof getAgendaHolidayForDate === 'function') ? getAgendaHolidayForDate(selectedDate) : null;

    // Jika hari libur agenda dan tidak ada aktivitas kerja, render pita hari libur resmi
    if (activitiesList.length === 0 && agendaHoliday) {
        ribbon.innerHTML = `
            <div class="w-full h-full bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 rounded-md flex items-center justify-center gap-2 text-rose-700 dark:text-rose-300 font-bold text-xs px-3">
                <i class="fa-solid fa-umbrella-beach text-rose-500"></i>
                <span>Hari Libur Agenda (${escapeHTML(agendaHoliday.title || 'Libur Resmi')})</span>
            </div>
        `;
        if (gapEl) {
            gapEl.textContent = `Hari Libur Resmi Agenda: ${agendaHoliday.title || 'Libur'}`;
            gapEl.className = "font-bold text-rose-600 dark:text-rose-400 text-xs";
        }
        return;
    }

    // Jika pegawai berstatus tidak melaksanakan tugas (Sakit / Cuti / Izin) dan tidak ada aktivitas
    if (activitiesList.length === 0 && currentDayAbsence) {
        const iconClass = currentDayAbsence.jenis === 'Sakit'
            ? 'fa-solid fa-hospital-user'
            : (currentDayAbsence.jenis === 'Cuti' ? 'fa-solid fa-plane-departure' : 'fa-solid fa-clipboard-user');
        ribbon.innerHTML = `
            <div class="w-full h-full bg-amber-50/90 dark:bg-amber-950/40 border border-amber-300/80 dark:border-amber-800/60 rounded-md flex items-center justify-between gap-2 text-amber-900 dark:text-amber-200 font-bold text-xs px-3">
                <div class="flex items-center gap-2 truncate">
                    <i class="${iconClass} text-amber-600 dark:text-amber-400 text-sm shrink-0"></i>
                    <span class="truncate">Tidak Melaksanakan Tugas: <b>${escapeHTML(currentDayAbsence.jenis)}</b></span>
                    <span class="text-[11px] font-normal text-amber-800/90 dark:text-amber-300/90 truncate">(${escapeHTML(currentDayAbsence.alasan || 'Keterangan resmi')})</span>
                </div>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-200/80 dark:bg-amber-900/60 text-amber-900 dark:text-amber-100 shrink-0">Sah</span>
            </div>
        `;
        if (gapEl) {
            gapEl.textContent = `Status: ${currentDayAbsence.jenis} (${currentDayAbsence.alasan || 'Keterangan resmi'}) - Jam Kerja Terealisasi 0 Menit (Sah)`;
            gapEl.className = "font-bold text-amber-700 dark:text-amber-300 text-xs";
        }
        return;
    }

    const DAY_START = 450; // 07:30 (menit dari jam 00:00)
    const DAY_END   = 930; // 15:30
    const TOTAL_SPAN = DAY_END - DAY_START; // 480 menit
    const REST_START = 750; // 12:30
    const REST_END   = 780; // 13:00

    // Urutkan aktivitas berdasarkan waktu mulai
    const sorted = [...activitiesList].sort((a, b) => a.start_time.localeCompare(b.start_time));

    let html = '';

    // Buat array interval yang tercover
    const coveredIntervals = [];

    sorted.forEach(act => {
        const [sh, sm] = act.start_time.split(':').map(Number);
        const [eh, em] = act.end_time.split(':').map(Number);
        if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return;

        let startMin = Math.max(DAY_START, sh * 60 + sm);
        let endMin = Math.min(DAY_END, eh * 60 + em);

        if (startMin < endMin) {
            coveredIntervals.push({ start: startMin, end: endMin, title: act.task_item_name || act.description });

            // Otomatisasi penyesuaian visual jika rentang kegiatan melintasi jam istirahat (12:30 - 13:00)
            const activitySegments = [];
            const crossesRest = (startMin < REST_END && endMin > REST_START);

            if (startMin < REST_START && endMin > REST_END) {
                // Membelah menjadi 2 segmen di sekitar jam istirahat
                activitySegments.push({ sMin: startMin, eMin: REST_START });
                activitySegments.push({ sMin: REST_END, eMin: endMin });
            } else if (startMin < REST_START && endMin > REST_START) {
                // Selesai di dalam atau saat awal istirahat
                activitySegments.push({ sMin: startMin, eMin: Math.min(endMin, REST_START) });
            } else if (startMin < REST_END && endMin > REST_END) {
                // Mulai di dalam atau saat akhir istirahat
                activitySegments.push({ sMin: Math.max(startMin, REST_END), eMin: endMin });
            } else if (startMin >= REST_START && endMin <= REST_END) {
                // Seluruh rentang berada tepat di dalam istirahat (0 menit efektif)
            } else {
                activitySegments.push({ sMin: startMin, eMin: endMin });
            }

            const effTotalMin = calculateEffectiveMinutes(act.start_time, act.end_time);
            const { groupName, groupCode, itemName, itemCode, concreteDesc } = resolveActivityDetails(act);
            const groupDisplay = groupName ? (groupCode ? `[${groupCode}] ${groupName}` : groupName) : '';
            const itemCodePrefix = itemCode ? `[${escapeHTML(itemCode)}] ` : '';
            const titleText = itemName ? `${itemCodePrefix}${escapeHTML(itemName)}` : (groupName ? escapeHTML(groupName) : 'Aktivitas Pegawai');
            const isDescDifferent = concreteDesc && concreteDesc.toLowerCase() !== (itemName || '').toLowerCase();
            const descText = (concreteDesc && (isDescDifferent || !itemName))
                ? `<p class="text-[11px] text-slate-300 mt-1 line-clamp-2 leading-relaxed">${escapeHTML(concreteDesc)}</p>`
                : '';
            const groupText = groupDisplay ? `<div class="text-[10px] text-indigo-300 font-semibold mt-1"><i class="fa-solid fa-layer-group text-[9px] mr-1"></i>${escapeHTML(groupDisplay)}</div>` : '';
            const locationText = act.location 
                ? `<div class="text-[11px] text-slate-300 flex items-center gap-1.5 mt-1 truncate"><i class="fa-solid fa-location-dot text-emerald-400 text-[10px] shrink-0"></i> <span class="truncate">${escapeHTML(act.location)}</span></div>`
                : '';
            const outputVal = act.output || act.output_evidence || act.output_description || '';
            const outputText = outputVal
                ? `<div class="text-[11px] text-slate-300 flex items-center gap-1.5 mt-0.5 truncate"><i class="fa-solid fa-box-archive text-blue-400 text-[10px] shrink-0"></i> <span class="truncate">${escapeHTML(outputVal)}</span></div>`
                : '';
            const dutyBadge = (act.is_outside_duty || act.is_official_duty)
                ? `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30"><i class="fa-solid fa-car-side text-[9px]"></i> Dinas Luar</span>`
                : '';
            const restBreakBadge = crossesRest
                ? `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-400/20 text-amber-300 border border-amber-400/30"><i class="fa-solid fa-mug-hot text-[9px]"></i> Jeda Istirahat (12:30–13:00)</span>`
                : '';

            activitySegments.forEach((seg, segIdx) => {
                const subStart = seg.sMin;
                const subEnd = seg.eMin;
                if (subStart >= subEnd) return;

                const leftPct = ((subStart - DAY_START) / TOTAL_SPAN) * 100;
                const widthPct = ((subEnd - subStart) / TOTAL_SPAN) * 100;
                const segDurationMin = subEnd - subStart;

                // Penentuan alignment tooltip agar tidak terpotong tepi layar
                let tooltipAlignClass = 'left-1/2 -translate-x-1/2';
                let arrowAlignClass = 'left-1/2 -translate-x-1/2';
                if (leftPct > 65) {
                    tooltipAlignClass = 'right-0';
                    arrowAlignClass = 'right-5';
                } else if (leftPct < 15) {
                    tooltipAlignClass = 'left-0';
                    arrowAlignClass = 'left-5';
                }

                const timeLabel = (activitySegments.length > 1 && segIdx > 0)
                    ? '13:00'
                    : act.start_time;

                const isDraft = (act.status === 'draft');
                const ribbonBgClass = isDraft 
                    ? 'bg-amber-500 hover:bg-amber-400 active:bg-amber-600 border-r border-amber-300/40' 
                    : 'bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 border-r border-white/25';
                const statusTooltipBadge = isDraft
                    ? `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 shrink-0">Draf Berjalan (${effTotalMin}m)</span>`
                    : `<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 shrink-0">${effTotalMin} Menit Efektif</span>`;

                html += `
                    <div onclick="window.editEmployeeActivity('${act.id}')"
                         role="button"
                         tabindex="0"
                         onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.editEmployeeActivity('${act.id}');}"
                         class="absolute h-full ${ribbonBgClass} transition-all cursor-pointer group rounded-sm last:border-r-0 z-20 hover:z-40 hover:shadow-lg hover:brightness-110 flex items-center justify-center overflow-visible" 
                         style="left: ${leftPct}%; width: ${widthPct}%;" 
                         title="${act.start_time} - ${act.end_time}: ${titleText} (Klik untuk edit)">
                        
                        <!-- Label jam ringkas di dalam balok jika ruang mencukupi -->
                        ${widthPct >= 8 ? `
                            <span class="text-[10px] font-extrabold text-slate-950 px-1 truncate pointer-events-none select-none">
                                ${timeLabel}
                            </span>
                        ` : ''}

                        <!-- Rich Hover Popover Tooltip -->
                        <div class="absolute bottom-full mb-2.5 ${tooltipAlignClass} hidden group-hover:flex flex-col w-64 sm:w-72 p-3 bg-slate-900/95 text-white rounded-xl shadow-2xl border border-slate-700/80 backdrop-blur-md pointer-events-none transition-all duration-150 z-50 text-left">
                            <div class="flex items-center justify-between gap-1 pb-1.5 border-b border-slate-800">
                                <span class="font-mono text-xs font-black ${isDraft ? 'text-amber-400' : 'text-emerald-400'} flex items-center gap-1.5">
                                    <i class="fa-regular fa-clock text-[11px]"></i> ${act.start_time} – ${act.end_time}
                                </span>
                                ${statusTooltipBadge}
                            </div>
                            ${groupText}
                            <div class="mt-1 font-bold text-xs text-white leading-snug">
                                ${titleText}
                            </div>
                            ${descText}
                            ${locationText}
                            ${outputText}
                            <div class="mt-2 pt-1.5 border-t border-slate-800 flex items-center justify-between text-[10px] flex-wrap gap-1">
                                <div class="flex items-center gap-1">${dutyBadge}${restBreakBadge}</div>
                                <span class="${isDraft ? 'text-amber-400' : 'text-emerald-400'} font-semibold flex items-center gap-1 ml-auto">
                                    <i class="fa-solid fa-pen-to-square text-[9px]"></i> Klik untuk edit / realisasikan
                                </span>
                            </div>
                            <!-- Arrow Tip Bawah -->
                            <div class="absolute top-full ${arrowAlignClass} border-4 border-transparent border-t-slate-900"></div>
                        </div>
                    </div>
                `;
            });
        }
    });

    // Pasang bar waktu istirahat (12:30 - 13:00) dengan popover tooltip informatif (z-30 agar tidak tertutup)
    const restLeft = ((REST_START - DAY_START) / TOTAL_SPAN) * 100;
    const restWidth = ((REST_END - REST_START) / TOTAL_SPAN) * 100;
    html += `
        <div class="absolute h-full bg-amber-400/95 hover:bg-amber-400 z-30 flex items-center justify-center cursor-default group/rest transition-colors border-x border-amber-500/50 shadow-xs overflow-visible" style="left: ${restLeft}%; width: ${restWidth}%;" title="Waktu Istirahat (12:30 - 13:00)">
            <span class="text-[8px] sm:text-[9px] font-black text-amber-950 uppercase tracking-tighter sm:tracking-normal px-0.5 truncate select-none">Istirahat</span>
            
            <!-- Hover Tooltip Istirahat -->
            <div class="absolute bottom-full mb-2.5 left-1/2 -translate-x-1/2 hidden group-hover/rest:flex flex-col w-56 p-2.5 bg-slate-900/95 text-white rounded-xl shadow-2xl border border-slate-700/80 backdrop-blur-md pointer-events-none transition-all duration-150 z-50 text-left">
                <div class="flex items-center justify-between gap-1 pb-1 border-b border-slate-800">
                    <span class="font-mono text-xs font-black text-amber-400 flex items-center gap-1">
                        <i class="fa-solid fa-mug-hot text-[11px]"></i> 12:30 – 13:00 WITA
                    </span>
                    <span class="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 border border-amber-800">
                        30m
                    </span>
                </div>
                <div class="mt-1 font-bold text-xs text-white">Waktu Istirahat Resmi</div>
                <p class="text-[10px] text-slate-300 mt-0.5 leading-relaxed">Istirahat siang resmi. Tidak dihitung ke dalam kalkulasi durasi efektif harian.</p>
                <div class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900"></div>
            </div>
        </div>
    `;

    ribbon.innerHTML = html;

    // Hitung gap / celah waktu kosong (di luar jam istirahat)
    let merged = [];
    // Masukkan istirahat sebagai interval terisi agar tidak dianggap gap
    const allIntervals = [...coveredIntervals, { start: REST_START, end: REST_END }].sort((a, b) => a.start - b.start);

    for (let cur of allIntervals) {
        if (!merged.length) {
            merged.push({ ...cur });
        } else {
            let last = merged[merged.length - 1];
            if (cur.start <= last.end) {
                last.end = Math.max(last.end, cur.end);
            } else {
                merged.push({ ...cur });
            }
        }
    }

    const gaps = [];
    let curTime = DAY_START;

    merged.forEach(m => {
        if (m.start > curTime) {
            gaps.push({ start: curTime, end: m.start });
        }
        curTime = Math.max(curTime, m.end);
    });

    if (curTime < DAY_END) {
        gaps.push({ start: curTime, end: DAY_END });
    }

    if (gapEl) {
        if (agendaHoliday) {
            gapEl.textContent = `Hari Libur Agenda (${agendaHoliday.title || 'Libur Resmi'}) - Celah jam tidak wajib dipenuhi.`;
            gapEl.className = "font-bold text-rose-600 dark:text-rose-400 text-xs";
        } else if (gaps.length === 0) {
            gapEl.textContent = "Tidak ada celah (Jadwal penuh)";
            gapEl.className = "font-bold text-emerald-600 dark:text-emerald-400 text-xs";
        } else {
            const gapStrings = gaps.map(g => {
                const sH = String(Math.floor(g.start / 60)).padStart(2, '0');
                const sM = String(g.start % 60).padStart(2, '0');
                const eH = String(Math.floor(g.end / 60)).padStart(2, '0');
                const eM = String(g.end % 60).padStart(2, '0');
                return `${sH}:${sM}-${eH}:${eM}`;
            });
            gapEl.textContent = gapStrings.join(', ');
            gapEl.className = "font-bold text-amber-600 dark:text-amber-400 text-xs";
        }
    }
}

// 7.5 Helper Resolusi Detail Aktivitas (Kelompok Penugasan, Butir Rincian Tugas, dan Uraian Konkret)
function resolveActivityDetails(act) {
    if (!act) {
        return {
            groupName: '',
            groupCode: '',
            itemName: '',
            itemCode: '',
            concreteDesc: ''
        };
    }

    let groupName = act.task_group_name || act.group_name || '';
    let groupCode = act.group_code || '';
    let itemName = act.task_item_name || act.task_name || '';
    let itemCode = act.task_code || act.item_code || '';
    const concreteDesc = (act.description || act.activity_description || act.uraian_kegiatan || '').trim();

    // Fallback resolver menggunakan masterSkData jika data relasi belum terisi di payload act
    if (masterSkData) {
        const allItems = masterSkData.task_items || masterSkData.items || [];
        const allGroups = masterSkData.groups || [];

        if ((!itemName || !itemCode) && act.task_item_id) {
            const foundItem = allItems.find(it => String(it.id) === String(act.task_item_id));
            if (foundItem) {
                if (!itemName) itemName = foundItem.item_name || foundItem.task_name || foundItem.uraian_tugas || '';
                if (!itemCode) itemCode = foundItem.item_code || foundItem.task_code || foundItem.kode_butir || '';
                if (!act.group_id && foundItem.group_id) {
                    act.group_id = foundItem.group_id;
                }
            }
        }

        if ((!groupName || !groupCode) && act.group_id) {
            const foundGroup = allGroups.find(g => String(g.id) === String(act.group_id));
            if (foundGroup) {
                if (!groupName) groupName = foundGroup.group_name || foundGroup.nama_kelompok || '';
                if (!groupCode) groupCode = foundGroup.group_code || foundGroup.kode_kelompok || '';
            }
        }
    }

    return {
        groupName,
        groupCode,
        itemName,
        itemCode,
        concreteDesc
    };
}
window.resolveActivityDetails = resolveActivityDetails;

// 8. Render Daftar Aktivitas Harian Pegawai
window.renderEmployeeActivities = function() {
    const container = document.getElementById('employee-activities-container');
    if (!container) return;

    const searchInput = document.getElementById('search-employee-activities');
    const queryStr = (searchInput?.value || '').toLowerCase().trim();

    // Kontrol visibilitas tombol bersihkan pencarian (#btn-clear-search)
    const btnClear = document.getElementById('btn-clear-search');
    if (btnClear) {
        if (queryStr) {
            btnClear.classList.remove('hidden');
        } else {
            btnClear.classList.add('hidden');
        }
    }

    const filtered = activitiesList.filter(act => {
        if (!queryStr) return true;
        const groupName = (act.task_group_name || act.group_name || '').toLowerCase();
        const itemName = (act.task_item_name || act.task_name || '').toLowerCase();
        const desc = (act.description || act.activity_description || '').toLowerCase();
        const loc = (act.location || '').toLowerCase();
        return groupName.includes(queryStr) || itemName.includes(queryStr) || desc.includes(queryStr) || loc.includes(queryStr);
    });

    if (filtered.length === 0) {
        if (isSupervisor && isMonitoringMode && !selectedEmployeeGtkId) {
            container.innerHTML = `
                <div class="col-span-full text-center py-12 opacity-60">
                    <i class="fa-solid fa-clipboard-user text-3xl mb-2 text-emerald-500"></i>
                    <p class="text-xs font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300">Mode Supervisi Aktif</p>
                    <p class="text-[11px] text-slate-400 mt-1 max-w-md mx-auto">Silakan pilih salah satu pegawai pada tabel supervisi di atas (klik tombol "Lihat Log") atau gunakan filter dropdown di atas untuk memantau log aktivitas tendik.</p>
                </div>
            `;
        } else {
            container.innerHTML = `
                <div class="col-span-full text-center py-12 opacity-40">
                    <i class="fa-solid fa-clipboard-list text-3xl mb-2 text-slate-400"></i>
                    <p class="text-xs font-bold uppercase tracking-widest text-slate-500">Tidak ada aktivitas</p>
                    <p class="text-[11px] text-slate-400 mt-1">Belum ada catatan aktivitas untuk tanggal ini.</p>
                </div>
            `;
        }
        return;
    }

    container.innerHTML = filtered.map(act => {
        const { groupName, groupCode, itemName, itemCode, concreteDesc } = resolveActivityDetails(act);
        const effMin = calculateEffectiveMinutes(act.start_time, act.end_time);
        const isDraft = (act.status === 'draft');
        const canFinalize = isDraft && isActivityTimeCompleted(act.tanggal || act.activity_date || selectedDate, act.end_time);

        const statusBadge = isDraft 
            ? `<span class="px-2 py-0.5 bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-extrabold text-[10px] rounded-md flex items-center gap-1 shrink-0 border border-amber-300/80 dark:border-amber-800/70"><i class="fa-solid fa-hourglass-half text-[9px]"></i> Draf Berjalan</span>`
            : `<span class="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-extrabold text-[10px] rounded-md flex items-center gap-1 shrink-0"><i class="fa-solid fa-circle-check text-[9px]"></i> Realisasi</span>`;

        const finalizeBtn = canFinalize
            ? `<button type="button" onclick="event.stopPropagation(); window.finalizeEmployeeActivity('${act.id}')" class="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] rounded-lg transition-all shadow-xs flex items-center gap-1 cursor-pointer active:scale-95" title="Waktu telah selesai. Klik untuk merealisasikan aktivitas ini ke jam kerja resmi">
                <i class="fa-solid fa-check text-[9px]"></i> Realisasikan
               </button>`
            : '';

        const outsideBadge = act.is_outside_duty 
            ? `<span class="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded text-[10px] font-bold flex items-center gap-1 shrink-0"><i class="fa-solid fa-car text-[9px]"></i> Dinas Luar</span>` 
            : '';
        const outputVal = act.output || act.output_description || '';
        const outputBadge = outputVal 
            ? `<span class="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1"><i class="fa-solid fa-box-archive text-[10px] text-slate-400"></i> Output: <strong>${escapeHTML(outputVal)}</strong></span>` 
            : '';
        const locationBadge = act.location 
            ? `<span class="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1"><i class="fa-solid fa-location-dot text-[10px] text-slate-400"></i> ${escapeHTML(act.location)}</span>` 
            : '';

        // Foto Bukti Kegiatan (Maks. 2 Foto)
        const photos = parseEvidencePhotos(act.bukti_url || act.evidence_url);
        const photoCount = photos.length;
        const photoBtn = photoCount > 0 ? `
            <button type="button" onclick="event.stopPropagation(); window.openEmployeeLightbox('${act.id}')" class="px-2 py-0.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/70 text-emerald-700 dark:text-emerald-300 font-bold text-[10px] flex items-center gap-1 transition-colors border border-emerald-200/80 dark:border-emerald-800/70 shadow-2xs cursor-pointer active:scale-95" title="Buka Foto Bukti Kegiatan (${photoCount} Foto)">
                <i class="fa-solid fa-camera text-[10px]"></i>
                <span>${photoCount} Foto Bukti</span>
            </button>
        ` : '';

        // 1. Info Kelompok Penugasan
        const groupDisplay = groupName ? (groupCode ? `[${groupCode}] ${groupName}` : groupName) : 'Tugas Pokok Pegawai';
        const groupBadge = `
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800/50">
                <i class="fa-solid fa-layer-group text-[9px] text-indigo-500"></i>
                <span class="truncate max-w-[200px]">${escapeHTML(groupDisplay)}</span>
            </span>
        `;

        // 2. Butir Rincian Tugas
        const itemCodePrefix = itemCode ? `<span class="font-mono text-[10px] text-emerald-600 dark:text-emerald-400 font-extrabold mr-1">[${escapeHTML(itemCode)}]</span>` : '';
        const itemDisplay = itemName ? `${itemCodePrefix}${escapeHTML(itemName)}` : (groupName ? escapeHTML(groupName) : 'Aktivitas Pokok');

        // 3. Uraian Kegiatan Konkret
        const isDescDifferent = concreteDesc && concreteDesc.toLowerCase() !== (itemName || '').toLowerCase();
        const concreteText = (concreteDesc && (isDescDifferent || !itemName)) ? concreteDesc : '-';

        const cardBorderClass = isDraft 
            ? 'bg-amber-50/30 dark:bg-amber-950/20 hover:bg-amber-50/50 dark:hover:bg-amber-950/30 border-amber-200/80 dark:border-amber-800/60 hover:border-amber-300 dark:hover:border-amber-700/60' 
            : 'bg-slate-50/80 dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/80 border-slate-200/70 dark:border-slate-700/60 hover:border-emerald-300 dark:hover:border-emerald-700/60';

        const timeBadgeClass = isDraft
            ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 border border-amber-300/70 dark:border-amber-800/60'
            : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300';

        return `
            <div class="rounded-xl p-2.5 sm:p-3 border border-slate-200/70 ${cardBorderClass} transition-all shadow-xs flex flex-col justify-between">
                <div class="min-w-0">
                    <!-- Baris 1: Jam, Durasi Efektif, Badge Status, Tombol Aksi -->
                    <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-1.5 flex-wrap min-w-0">
                            <span class="px-2 py-0.5 ${timeBadgeClass} font-extrabold text-[11px] sm:text-xs rounded-md flex items-center gap-1 shrink-0">
                                <i class="fa-regular fa-clock text-[10px]"></i> ${act.start_time} - ${act.end_time}
                            </span>
                            <span class="text-[11px] font-bold text-slate-500 dark:text-slate-400 shrink-0">
                                (${effMin} menit)
                            </span>
                            ${statusBadge}
                            ${outsideBadge}
                        </div>
                        <div class="flex items-center gap-1.5 shrink-0">
                            ${finalizeBtn}
                            ${photoBtn}
                            <button type="button" onclick="window.editEmployeeActivity('${act.id}')" class="w-7 h-7 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 transition-all flex items-center justify-center cursor-pointer" title="Edit Aktivitas" aria-label="Edit Aktivitas">
                                <i class="fa-solid fa-pen text-[11px]"></i>
                            </button>
                        </div>
                    </div>

                    <!-- Baris 2: Info Kelompok Penugasan & Butir Rincian Tugas -->
                    <div class="mt-2 space-y-1">
                        <div>${groupBadge}</div>
                        <h4 class="text-xs sm:text-sm font-bold text-slate-800 dark:text-white leading-snug">
                            <i class="fa-solid fa-list-check text-emerald-500 mr-1 text-[11px]"></i>${itemDisplay}
                        </h4>
                    </div>

                    <!-- Baris 3: Uraian Kegiatan Konkret -->
                    ${concreteText && concreteText !== '-' ? `
                        <div class="mt-1.5 p-2 rounded-lg bg-white/70 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-800">
                            <div class="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-0.5">Uraian Kegiatan Konkret:</div>
                            <p class="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed">
                                ${escapeHTML(concreteText)}
                            </p>
                        </div>
                    ` : ''}
                </div>

                <!-- Baris 4: Lokasi & Output Pekerjaan (Hanya jika terisi) -->
                ${(locationBadge || outputBadge) ? `
                    <div class="flex items-center gap-3 mt-2 pt-1.5 border-t border-slate-200/50 dark:border-slate-700/40 text-[11px] text-slate-500 dark:text-slate-400 flex-wrap">
                        ${locationBadge}
                        ${outputBadge}
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
};

/**
 * Bersihkan input pencarian aktivitas pegawai dan reset daftar tampilan
 */
window.clearActivitySearch = function() {
    const searchInput = document.getElementById('search-employee-activities');
    const btnClear = document.getElementById('btn-clear-search');
    if (searchInput) {
        searchInput.value = '';
    }
    if (btnClear) {
        btnClear.classList.add('hidden');
    }
    if (typeof window.renderEmployeeActivities === 'function') {
        window.renderEmployeeActivities();
    }
};

// 9. Event Toolbar: Pemilihan Pekan/Tanggal & Switcher Pegawai
window.navigateEmployeeWeek = async function(direction) {
    const parts = selectedDate.split('-');
    const cur = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    cur.setDate(cur.getDate() + (direction * 7));
    selectedDate = formatYMD(cur);
    const inputDate = document.getElementById('input-agenda-date');
    if (inputDate) inputDate.value = selectedDate;
    selectedSummaryWeekDate = selectedDate;
    await loadEmployeeDayData();
};

// Alias kompatibilitas ke belakang (backwards compatibility)
window.navigateEmployeeDate = window.navigateEmployeeWeek;

window.onEmployeeDateChange = async function() {
    const inputDate = document.getElementById('input-agenda-date');
    if (!inputDate || !inputDate.value) return;

    selectedDate = inputDate.value;
    selectedSummaryWeekDate = selectedDate;
    await loadEmployeeDayData();
};

window.setEmployeeToday = async function() {
    selectedDate = formatYMD(new Date());
    const inputDate = document.getElementById('input-agenda-date');
    if (inputDate) inputDate.value = selectedDate;
    selectedSummaryWeekDate = selectedDate;
    await loadEmployeeDayData();
};

/**
 * Beralih antara Agenda Kerja Saya (Mode Pribadi) dan Mode Monitoring (Supervisi Tendik)
 */
window.toggleMonitoringModeView = async function() {
    isMonitoringMode = !isMonitoringMode;
    const switcherWrapper = document.getElementById('employee-switcher-wrapper');
    const btnIcon = document.getElementById('btn-monitoring-mode-icon');
    const btnText = document.getElementById('btn-monitoring-mode-text');
    const filterSelect = document.getElementById('select-employee-filter');
    const summaryPanel = document.getElementById('section-employee-summary-view');
    const individualWrapper = document.getElementById('employee-individual-view-wrapper');
    const bannerInspect = document.getElementById('banner-inspecting-employee');
    const btnOpenModal = document.getElementById('btn-open-activity-modal');
    const fabWrapper = document.getElementById('fab-open-activity-modal-wrapper');

    // Dropdown header selalu disembunyikan agar header bersih dan ringkas
    if (switcherWrapper) switcherWrapper.classList.add('hidden');
    // Jika beralih mode, bersihkan mode inspeksi individu pegawai
    if (bannerInspect) bannerInspect.classList.add('hidden');

    if (filterSelect) filterSelect.value = '';
    selectedEmployeeGtkId = '';
    selectedEmployeeUid = '';
    selectedEmployeeName = '';

    if (isMonitoringMode) {
        if (btnIcon) btnIcon.className = 'fa-solid fa-user text-emerald-400 text-xs';
        if (btnText) btnText.textContent = 'Agenda Saya';
        // Tampilkan tabel monitoring supervisi
        if (summaryPanel) summaryPanel.classList.remove('hidden');
        // Sembunyikan 3 grid individual (akumulasi kinerja pekan, visual timeline, dan aktivitas harian)
        if (individualWrapper) individualWrapper.classList.add('hidden');
        // Sembunyikan tombol catat aktivitas
        if (btnOpenModal) btnOpenModal.classList.add('hidden');
        if (fabWrapper) fabWrapper.classList.add('hidden');

        updateHeaderContext();

        if (typeof window.setSummaryMode === 'function') {
            await window.setSummaryMode('weekly');
        }
    } else {
        if (btnIcon) btnIcon.className = 'fa-solid fa-chart-line text-amber-400 text-xs';
        if (btnText) btnText.textContent = 'Mode Monitoring';
        // Sembunyikan tabel monitoring supervisi
        if (summaryPanel) summaryPanel.classList.add('hidden');
        // Munculkan kembali tampilan individual untuk agenda kerja pribadi pimpinan
        if (individualWrapper) individualWrapper.classList.remove('hidden');

        if (btnOpenModal) btnOpenModal.classList.remove('hidden');
        if (fabWrapper) fabWrapper.classList.remove('hidden');

        updateHeaderContext();
        await loadEmployeeDayData();
    }
};

window.onEmployeeFilterChange = async function() {
    const select = document.getElementById('select-employee-filter');
    if (!select) return;

    selectedEmployeeGtkId = select.value || '';
    selectedEmployeeUid = selectedEmployeeGtkId;
    if (selectedEmployeeGtkId) {
        selectedEmployeeName = select.options[select.selectedIndex]?.text || '';
    } else {
        selectedEmployeeName = isSupervisor ? '' : currentUserName;
    }

    await loadEmployeeDayData();
};

/**
 * Helper: Ambil seluruh aktivitas pada tanggal tertentu untuk pegawai aktif
 */
function getActivitiesForDate(dateStr) {
    if (!dateStr) return [];
    const targetGtk = (isSupervisor && selectedEmployeeGtkId) ? String(selectedEmployeeGtkId) : null;
    const matches = [];
    const seenIds = new Set();

    const addAct = (act) => {
        if (!act) return;
        const id = act.id ? String(act.id) : null;
        if (id && seenIds.has(id)) return;

        const actDate = act.tanggal || act.date || act.activity_date;
        if (actDate !== dateStr) return;

        if (targetGtk) {
            const actGtk = act.gtk_id ? String(act.gtk_id) : (act.user_uid ? String(act.user_uid) : null);
            if (actGtk && actGtk !== targetGtk) return;
        }

        if (id) seenIds.add(id);
        matches.push(act);
    };

    if (Array.isArray(activitiesList)) {
        activitiesList.forEach(addAct);
    }
    if (Array.isArray(currentWeeklyActivities)) {
        currentWeeklyActivities.forEach(addAct);
    }

    return matches;
}
window.getActivitiesForDate = getActivitiesForDate;

/**
 * Cek bentrok / tumpang tindih waktu (Live Overlap Check)
 */
window.checkTimeOverlap = function() {
    const warningEl = document.getElementById('modal-activity-overlap-warning');
    const warningText = document.getElementById('modal-activity-overlap-text');
    const warningTitle = document.getElementById('modal-activity-overlap-title');
    const saveBtn = document.getElementById('btn-save-activity');

    const dateVal = document.getElementById('form-activity-date')?.value;
    const startVal = document.getElementById('form-activity-start')?.value;
    const endVal = document.getElementById('form-activity-end')?.value;

    if (!warningEl || !warningText) return false;

    // 1. Cek jika data waktu belum lengkap
    if (!dateVal || !startVal || !endVal) {
        warningEl.classList.add('hidden');
        if (saveBtn) saveBtn.disabled = false;
        return false;
    }

    // 2. Cek jam mulai paling awal 07:30
    if (startVal < '07:30') {
        if (warningTitle) warningTitle.textContent = 'Jam Mulai Tidak Memenuhi Syarat';
        warningText.innerHTML = `Jam mulai kegiatan paling awal adalah pukul <b>07:30</b>. Waktu yang dipilih (<b>${escapeHTML(startVal)}</b>) berada di luar ketentuan.`;
        warningEl.classList.remove('hidden');
        if (saveBtn) saveBtn.disabled = true;
        return true;
    }

    // 3. Cek urutan jam mulai vs jam selesai
    if (startVal >= endVal) {
        if (warningTitle) warningTitle.textContent = 'Urutan Jam Tidak Valid';
        warningText.innerHTML = `Jam selesai (<b>${escapeHTML(endVal)}</b>) harus lebih besar dari jam mulai (<b>${escapeHTML(startVal)}</b>).`;
        warningEl.classList.remove('hidden');
        if (saveBtn) saveBtn.disabled = true;
        return true;
    }

    // 4. Cek durasi minimal kegiatan 30 menit
    const [sh, sm] = startVal.split(':').map(Number);
    const [eh, em] = endVal.split(':').map(Number);
    const durationMin = (eh * 60 + em) - (sh * 60 + sm);
    if (durationMin < 30) {
        if (warningTitle) warningTitle.textContent = 'Durasi Terlalu Singkat';
        warningText.innerHTML = `Durasi kegiatan minimal adalah <b>30 menit</b>. Durasi yang dipilih saat ini hanya <b>${durationMin} menit</b> (${escapeHTML(startVal)}–${escapeHTML(endVal)}).`;
        warningEl.classList.remove('hidden');
        if (saveBtn) saveBtn.disabled = true;
        return true;
    }

    // 5. Cek tumpang tindih waktu (overlap) dengan aktivitas lain
    const acts = (typeof getActivitiesForDate === 'function'
        ? getActivitiesForDate(dateVal)
        : (typeof window !== 'undefined' && typeof window.getActivitiesForDate === 'function'
            ? window.getActivitiesForDate(dateVal)
            : []));
    let conflictingAct = null;

    for (const act of acts) {
        if (editingActivityId && String(act.id) === String(editingActivityId)) {
            continue;
        }
        const actStart = act.start_time || act.jam_mulai;
        const actEnd = act.end_time || act.jam_selesai;
        if (!actStart || !actEnd) continue;

        // Formula overlap: start < actEnd && end > actStart
        if (startVal < actEnd && endVal > actStart) {
            conflictingAct = act;
            break;
        }
    }

    if (conflictingAct) {
        const desc = conflictingAct.description || conflictingAct.activity_description || conflictingAct.task_item_name || 'Aktivitas lain';
        const cStart = conflictingAct.start_time || conflictingAct.jam_mulai;
        const cEnd = conflictingAct.end_time || conflictingAct.jam_selesai;
        if (warningTitle) warningTitle.textContent = 'Waktu Bentrok / Tumpang Tindih';
        warningText.innerHTML = `Rentang waktu <b>${escapeHTML(startVal)}–${escapeHTML(endVal)}</b> tumpang tindih dengan aktivitas <b>"${escapeHTML(desc)}"</b> (${escapeHTML(cStart)}–${escapeHTML(cEnd)}). Silakan sesuaikan jam mulai/selesai.`;
        warningEl.classList.remove('hidden');
        if (saveBtn) saveBtn.disabled = true;
        return true;
    } else {
        warningEl.classList.add('hidden');
        if (saveBtn) saveBtn.disabled = false;
        return false;
    }
};

/**
 * Handler saat jam mulai atau jam selesai diubah
 */
window.onActivityTimeChange = function() {
    window.updateEffectivePreview();
    window.checkTimeOverlap();
    updateModalSaveButtonState();
};

/**
 * Handler reaktif saat tanggal pada form modal diubah
 */
window.onActivityDateChange = async function() {
    const dateInput = document.getElementById('form-activity-date');
    if (!dateInput || !dateInput.value) return;

    const newDate = dateInput.value;

    if (!editingActivityId) {
        let acts = getActivitiesForDate(newDate);
        if (acts.length === 0) {
            try {
                const targetGtk = (isSupervisor && selectedEmployeeGtkId) ? selectedEmployeeGtkId : '';
                const params = { date: newDate };
                if (targetGtk) params.gtk_id = targetGtk;
                const res = await cfClient.getEmployeeActivities(params);
                const dataArr = res?.data || (Array.isArray(res) ? res : []);
                if (Array.isArray(dataArr) && dataArr.length > 0) {
                    dataArr.forEach(item => {
                        if (!currentWeeklyActivities.some(c => String(c.id) === String(item.id))) {
                            currentWeeklyActivities.push(item);
                        }
                    });
                }
            } catch (e) {
                console.warn('[onActivityDateChange] Gagal memuat data tanggal baru:', e);
            }
        }

        const dateActs = getActivitiesForDate(newDate);
        let nextStartTime = '07:30';
        if (dateActs && dateActs.length > 0) {
            const endTimes = dateActs
                .map(a => a.end_time || a.jam_selesai)
                .filter(Boolean)
                .sort();
            if (endTimes.length > 0) {
                nextStartTime = endTimes[endTimes.length - 1];
            }
        }
        if (nextStartTime < '07:30') nextStartTime = '07:30';
        if (nextStartTime >= '12:30' && nextStartTime < '13:00') nextStartTime = '13:00';
        if (nextStartTime >= '15:30') nextStartTime = '07:30';

        const [sh, sm] = nextStartTime.split(':').map(Number);
        const endTotal = sh * 60 + sm + 60; // Default +60 menit (1 Jam)
        const endStr = calculateEndTimeWithBreaksAgenda(nextStartTime, 60);
        const startEl = document.getElementById('form-activity-start');
        const endEl = document.getElementById('form-activity-end');
        if (startEl) startEl.value = nextStartTime;
        if (endEl) endEl.value = endStr;
    }

    window.updateEffectivePreview();
    window.checkTimeOverlap();
    updateModalSaveButtonState();
};

// 10. Modal Aktivitas: Open, Close, Preview, Save, Delete
window.openActivityModal = function(actId = null) {
    editingActivityId = actId;
    const modal = document.getElementById('modal-employee-activity');
    const content = document.getElementById('modal-activity-content');
    const titleEl = document.getElementById('modal-activity-title');
    const form = document.getElementById('form-employee-activity');
    const btnDeleteModal = document.getElementById('btn-delete-activity-modal');

    if (!modal) return;

    if (btnDeleteModal) {
        if (actId) {
            btnDeleteModal.classList.remove('hidden');
        } else {
            btnDeleteModal.classList.add('hidden');
        }
    }

    if (form) form.reset();

    const dateInput = document.getElementById('form-activity-date');
    if (dateInput) dateInput.value = selectedDate;

    const groupSelect = document.getElementById('form-activity-group');
    const taskSelect = document.getElementById('form-activity-task-item');

    if (actId) {
        if (titleEl) titleEl.textContent = 'Edit Realisasi Aktivitas Harian';
        let act = activitiesList.find(a => String(a.id) === String(actId));
        if (!act && currentWeeklyActivities.length > 0) {
            act = currentWeeklyActivities.find(a => String(a.id) === String(actId));
        }
        if (act) {
            document.getElementById('form-activity-id').value = act.id;
            if (dateInput) dateInput.value = act.date || act.activity_date || act.tanggal || selectedDate;
            document.getElementById('form-activity-start').value = act.start_time || act.jam_mulai || '';
            document.getElementById('form-activity-end').value = act.end_time || act.jam_selesai || '';
            document.getElementById('form-activity-desc').value = act.description || act.activity_description || '';
            const isTargetKs = isCurrentTargetPrincipal();
            document.getElementById('form-activity-location').value = act.location || (isTargetKs ? '' : 'Ruang Tata Usaha');
            document.getElementById('form-activity-output').value = act.output || act.output_description || act.output_summary || '';
            document.getElementById('form-activity-outside').checked = Boolean(act.is_outside_duty || act.is_dinas_luar);

            // Muat foto bukti kegiatan jika ada
            _currentActivityPhotos = parseEvidencePhotos(act.bukti_url || act.evidence_url);

            const gId = act.task_group_id || act.group_id;
            const tId = act.task_item_id;
            if (groupSelect && gId) {
                groupSelect.value = gId;
                window.onActivityGroupChange();
                if (taskSelect && tId) {
                    taskSelect.value = tId;
                }
            }
        }
    } else {
        if (titleEl) titleEl.textContent = 'Catat Realisasi Aktivitas Harian';
        const subtitleEl = document.getElementById('modal-activity-subtitle');
        const isPersonalMode = !isSupervisor || !isMonitoringMode;
        const targetPersonName = isPersonalMode
            ? (currentUserName || (isCurrentTargetPrincipal() ? 'Kepala Sekolah' : 'Pegawai SIMAS'))
            : (selectedEmployeeName || (selectedEmployeeGtkId ? 'Pegawai Terpilih' : currentUserName));
        if (subtitleEl) {
            subtitleEl.innerHTML = `<span class="text-emerald-600 dark:text-emerald-400 font-semibold">${escapeHTML(targetPersonName)}</span> • Pilih butir tugas dan input rincian konkret`;
        }

        document.getElementById('form-activity-id').value = '';

        // Reset daftar foto bukti untuk aktivitas baru
        _currentActivityPhotos = [];

        const dateVal = dateInput ? dateInput.value : selectedDate;
        const targetActs = getActivitiesForDate(dateVal);
        let nextStartTime = '07:30';
        if (targetActs && targetActs.length > 0) {
            const endTimes = targetActs
                .map(a => a.end_time || a.jam_selesai)
                .filter(Boolean)
                .sort();
            if (endTimes.length > 0) {
                nextStartTime = endTimes[endTimes.length - 1];
            }
        } else if (activitiesList && activitiesList.length > 0) {
            const endTimes = activitiesList
                .map(a => a.end_time || a.jam_selesai)
                .filter(Boolean)
                .sort();
            if (endTimes.length > 0) {
                nextStartTime = endTimes[endTimes.length - 1];
            }
        }
        if (nextStartTime < '07:30') nextStartTime = '07:30';
        if (nextStartTime >= '12:30' && nextStartTime < '13:00') nextStartTime = '13:00';
        if (nextStartTime >= '15:30') nextStartTime = '07:30';
        document.getElementById('form-activity-start').value = nextStartTime;

        const [sh, sm] = nextStartTime.split(':').map(Number);
        const endTotal = sh * 60 + sm + 60; // Default +60 menit (1 Jam)
        const endStr = calculateEndTimeWithBreaksAgenda(nextStartTime, 60);
        document.getElementById('form-activity-end').value = endStr;
        const isTargetKs = isCurrentTargetPrincipal();
        document.getElementById('form-activity-location').value = isTargetKs ? '' : 'Ruang Tata Usaha';
        document.getElementById('form-activity-outside').checked = false;

        // Prefill kelompok tugas sesuai penugasan SK pegawai aktif (SSOT master penugasan)
        if (groupSelect && ((masterSkData?.groups?.length > 0) || (DEFAULT_PRINCIPAL_GROUPS?.length > 0))) {
            let defaultGroupId = '';
            if (isCurrentTargetPrincipal()) {
                const ksFirstGroup = (masterSkData?.groups || []).find(g => isPrincipalGroup(g)) || DEFAULT_PRINCIPAL_GROUPS[0];
                if (ksFirstGroup) defaultGroupId = ksFirstGroup.id;
            } else if (employeeAssignments && employeeAssignments.length > 0 && employeeAssignments[0].group_id) {
                // Gunakan kelompok tugas resmi dari penugasan SK pegawai
                defaultGroupId = employeeAssignments[0].group_id;
            } else if (isSupervisor && selectedEmployeeGtkId && Array.isArray(allAssignmentsList)) {
                const match = allAssignmentsList.find(a => 
                    String(a.gtk_id) === String(selectedEmployeeGtkId) || 
                    String(a.id) === String(selectedEmployeeGtkId) ||
                    (selectedEmployeeName && String(a.employee_name).toLowerCase().includes(selectedEmployeeName.toLowerCase()))
                );
                if (match && match.group_id) defaultGroupId = match.group_id;
            }

            if (!defaultGroupId && masterSkData?.groups?.length > 0) {
                defaultGroupId = masterSkData.groups[0].id;
            }
            if (defaultGroupId) {
                groupSelect.value = defaultGroupId;
                window.onActivityGroupChange();
            }
        }
    }

    renderActivityPhotosGrid();
    window.updateEffectivePreview();
    window.checkTimeOverlap();
    updateModalSaveButtonState();

    modal.classList.remove('hidden');
    setTimeout(() => {
        if (content) {
            content.classList.remove('scale-95', 'opacity-0');
            content.classList.add('scale-100', 'opacity-100');
        }
    }, 20);
};

/**
 * Kalkulasi jam selesai otomatis dengan melewati jam istirahat resmi (12:30 - 13:00)
 */
export function calculateEndTimeWithBreaksAgenda(startTime, durationMinutes) {
    if (!startTime || !startTime.includes(':')) return '';
    let [h, m] = startTime.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return '';
    let currentTotalMinutes = h * 60 + m;
    let remainingMinutes = Number(durationMinutes || 0);

    const REST_START = 750; // 12:30
    const REST_END   = 780; // 13:00

    while (remainingMinutes > 0) {
        if (currentTotalMinutes >= REST_START && currentTotalMinutes < REST_END) {
            currentTotalMinutes = REST_END;
        }
        currentTotalMinutes++;
        remainingMinutes--;
    }

    if (currentTotalMinutes > REST_START && currentTotalMinutes <= REST_END) {
        currentTotalMinutes = REST_END;
    }

    const endH = Math.floor(currentTotalMinutes / 60) % 24;
    const endM = currentTotalMinutes % 60;
    return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}
window.calculateEndTimeWithBreaksAgenda = calculateEndTimeWithBreaksAgenda;

/**
 * Terapkan Durasi Cepat pada Formulir Aktivitas
 */
window.applyQuickDuration = function(minutes) {
    const startVal = document.getElementById('form-activity-start')?.value || '07:30';
    const endStr = calculateEndTimeWithBreaksAgenda(startVal, minutes);

    const endEl = document.getElementById('form-activity-end');
    if (endEl) {
        endEl.value = endStr;
    }

    window.updateEffectivePreview();
    window.checkTimeOverlap();
    updateModalSaveButtonState();

    const quickBtns = document.querySelectorAll('.btn-quick-dur, .btn-quick-duration');
    quickBtns.forEach(btn => {
        const btnMin = Number(btn.getAttribute('data-minutes'));
        if (btnMin === Number(minutes)) {
            btn.classList.add('bg-emerald-600', 'text-white', 'border-emerald-600');
            btn.classList.remove('bg-slate-100', 'dark:bg-slate-800', 'text-slate-600', 'dark:text-slate-300', 'border-slate-200');
        } else {
            btn.classList.remove('bg-emerald-600', 'text-white', 'border-emerald-600');
            btn.classList.add('bg-slate-100', 'dark:bg-slate-800', 'text-slate-600', 'dark:text-slate-300', 'border-slate-200');
        }
    });
};

window.closeActivityModal = function() {
    editingActivityId = null;
    _currentActivityPhotos = [];
    const modal = document.getElementById('modal-employee-activity');
    const content = document.getElementById('modal-activity-content');
    const btnDeleteModal = document.getElementById('btn-delete-activity-modal');
    if (btnDeleteModal) btnDeleteModal.classList.add('hidden');
    if (!modal) return;

    if (content) {
        content.classList.remove('scale-100', 'opacity-100');
        content.classList.add('scale-95', 'opacity-0');
    }

    setTimeout(() => {
        modal.classList.add('hidden');
    }, 200);
};

window.updateEffectivePreview = function() {
    const startVal = document.getElementById('form-activity-start')?.value || '';
    const endVal = document.getElementById('form-activity-end')?.value || '';
    const previewEl = document.getElementById('preview-effective-val');
    if (!previewEl) return;

    const min = calculateEffectiveMinutes(startVal, endVal);
    const hours = (min / 60).toFixed(1);

    if (min <= 0) {
        previewEl.textContent = "0 Menit (Di luar jam kerja / jam istirahat)";
        previewEl.className = "font-extrabold text-slate-400";
    } else {
        const [sh, sm] = startVal.split(':').map(Number);
        const [eh, em] = endVal.split(':').map(Number);
        const totalSpan = (eh * 60 + em) - (sh * 60 + sm);
        const hasBreak = (sh * 60 + sm < 780 && eh * 60 + em > 750);
        const restNote = (hasBreak && totalSpan > min) ? ' (Memotong 30m istirahat)' : '';
        previewEl.textContent = `${min} Menit (${hours} Jam)${restNote}`;
        previewEl.className = "font-extrabold text-emerald-700 dark:text-emerald-300";
    }

    if (startVal && endVal) {
        const [sh, sm] = startVal.split(':').map(Number);
        const [eh, em] = endVal.split(':').map(Number);
        const diff = (eh * 60 + em) - (sh * 60 + sm);
        const quickBtns = document.querySelectorAll('.btn-quick-duration');
        quickBtns.forEach(btn => {
            const btnMin = Number(btn.getAttribute('data-minutes'));
            if (btnMin === diff) {
                btn.classList.add('bg-emerald-600', 'text-white', 'border-emerald-600');
                btn.classList.remove('bg-slate-100', 'dark:bg-slate-800', 'text-slate-600', 'dark:text-slate-300', 'border-slate-200');
            } else {
                btn.classList.remove('bg-emerald-600', 'text-white', 'border-emerald-600');
                btn.classList.add('bg-slate-100', 'dark:bg-slate-800', 'text-slate-600', 'dark:text-slate-300', 'border-slate-200');
            }
        });
    }
};

window.editEmployeeActivity = function(id) {
    window.openActivityModal(id);
};

window.saveEmployeeActivity = async function() {
    if (typeof isSupervisorViewingOthers === 'function' && isSupervisorViewingOthers()) {
        if (window.showToast) window.showToast('Akses Dibatasi', SUPERVISOR_READONLY_MSG, 'warning');
        return;
    }
    const forcedStatus = arguments[0];
    const dateVal = document.getElementById('form-activity-date').value;
    const startVal = document.getElementById('form-activity-start').value;
    const endVal = document.getElementById('form-activity-end').value;
    const groupId = document.getElementById('form-activity-group').value;
    let taskId = document.getElementById('form-activity-task-item').value;
    const desc = document.getElementById('form-activity-desc').value.trim();
    const loc = document.getElementById('form-activity-location').value.trim();
    const output = document.getElementById('form-activity-output').value.trim();
    const isOutside = document.getElementById('form-activity-outside').checked ? 1 : 0;

    const groupsList = (typeof masterSkData !== 'undefined' && masterSkData?.groups) ? masterSkData.groups : [];
    const defaultPrincipalList = (typeof DEFAULT_PRINCIPAL_GROUPS !== 'undefined') ? DEFAULT_PRINCIPAL_GROUPS : [];
    const selectedGroup = groupsList.find(g => String(g.id) === String(groupId)) ||
        defaultPrincipalList.find(g => String(g.id) === String(groupId) || String(g.kode_kelompok) === String(groupId));
    const isPrincipal = (typeof isPrincipalGroup === 'function' && isPrincipalGroup(selectedGroup)) || 
        (typeof isCurrentTargetPrincipal === 'function' && isCurrentTargetPrincipal());

    if (isPrincipal && !taskId) {
        taskId = groupId || 'ks-main-task';
    }

    if (!dateVal || !startVal || !endVal || !groupId || (!taskId && !isPrincipal) || !desc) {
        if (window.showToast) window.showToast('Peringatan', 'Harap lengkapi semua kolom wajib bertanda bintang.', 'warning');
        return;
    }

    if (startVal < '07:30') {
        if (window.showToast) window.showToast('Peringatan', 'Jam mulai kegiatan paling awal adalah pukul 07:30.', 'warning');
        return;
    }

    if (startVal >= endVal) {
        if (window.showToast) window.showToast('Peringatan', 'Jam selesai harus lebih besar dari jam mulai.', 'warning');
        return;
    }

    const [sh, sm] = startVal.split(':').map(Number);
    const [eh, em] = endVal.split(':').map(Number);
    const durationMin = (eh * 60 + em) - (sh * 60 + sm);
    if (durationMin < 30) {
        if (window.showToast) window.showToast('Peringatan', 'Durasi kegiatan minimal 30 menit.', 'warning');
        return;
    }

    if (window.checkTimeOverlap && window.checkTimeOverlap()) {
        if (window.showToast) window.showToast('Peringatan', 'Waktu kegiatan tidak valid atau tumpang tindih dengan aktivitas lain pada hari yang sama.', 'warning');
        return;
    }

    // Validasi status pengunggahan foto bukti
    const hasUploading = _currentActivityPhotos.some(p => p.state === 'uploading');
    if (hasUploading) {
        if (window.showToast) window.showToast('Peringatan', 'Foto bukti sedang dalam proses pengunggahan. Mohon tunggu sejenak hingga selesai.', 'warning');
        return;
    }

    const hasFailed = _currentActivityPhotos.some(p => p.state === 'failed');
    if (hasFailed) {
        if (window.showToast) window.showToast('Peringatan', 'Terdapat foto bukti yang gagal diunggah. Silakan klik tombol "Coba Lagi" pada foto yang gagal atau hapus foto tersebut.', 'warning');
        return;
    }

    const readyPhotos = _currentActivityPhotos
        .filter(p => p.url && p.state !== 'uploading')
        .map(p => ({
            url: p.url,
            fileId: p.fileId || '',
            name: p.name || 'Foto Bukti',
            caption: (p.caption || '').trim()
        }));

    // Validasi wajib foto bukti kegiatan minimal 1 foto
    if (readyPhotos.length === 0) {
        if (window.showToast) window.showToast('Foto Bukti Kegiatan Wajib', 'Wajib mengunggah minimal 1 foto bukti kegiatan (maksimal 2 foto).', 'warning');
        return;
    }

    const buktiPayload = JSON.stringify(readyPhotos);

    // Penentuan status otomatis: draft jika waktu belum selesai, submitted jika waktu sudah selesai
    const isCompleted = isActivityTimeCompleted(dateVal, endVal);
    let status = isCompleted ? 'submitted' : 'draft';
    if (forcedStatus) status = forcedStatus;

    const btn = document.getElementById('btn-save-activity');
    const btnDraftAlt = document.getElementById('btn-save-draft-alt');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Menyimpan...';
    }
    if (btnDraftAlt) btnDraftAlt.disabled = true;

    try {
        const payload = {
            date: dateVal,
            activity_date: dateVal,
            start_time: startVal,
            end_time: endVal,
            group_id: isNaN(Number(groupId)) ? groupId : Number(groupId),
            task_group_id: isNaN(Number(groupId)) ? groupId : Number(groupId),
            task_item_id: taskId ? (isNaN(Number(taskId)) ? taskId : Number(taskId)) : null,
            description: desc,
            activity_description: desc,
            location: loc || 'Ruang Tata Usaha',
            output: output || '',
            output_description: output || '',
            is_outside_duty: isOutside,
            bukti_url: buktiPayload,
            status: status
        };

        const matchingAsg = (employeeAssignments || []).find(a => String(a.group_id) === String(groupId));
        if (matchingAsg && matchingAsg.id) {
            payload.assignment_id = matchingAsg.id;
        }

        const isPersonalMode = !isSupervisor || !isMonitoringMode;
        if (!isPersonalMode && isSupervisor && selectedEmployeeGtkId) {
            payload.gtk_id = selectedEmployeeGtkId;
        }

        if (editingActivityId) {
            await cfClient.updateEmployeeActivity(editingActivityId, payload);
            if (window.showToast) {
                if (status === 'draft') {
                    window.showToast('Tersimpan sebagai Draf', 'Aktivitas berhasil diperbarui sebagai draf (belum terhitung realisasi).', 'info');
                } else {
                    window.showToast('Berhasil', 'Aktivitas berhasil diperbarui ke realisasi resmi.', 'success');
                }
            }
        } else {
            await cfClient.createEmployeeActivity(payload);
            if (window.showToast) {
                if (status === 'draft') {
                    window.showToast('Tersimpan sebagai Draf', 'Waktu kegiatan belum selesai. Aktivitas tersimpan sebagai draf dan belum terhitung realisasi.', 'info');
                } else {
                    window.showToast('Berhasil', 'Aktivitas baru berhasil disimpan ke realisasi kerja.', 'success');
                }
            }
        }

        window.closeActivityModal();
        await loadEmployeeDayData();

    } catch (e) {
        console.error('[saveEmployeeActivity] Error:', e);
        const errMsg = e.message || 'Gagal menyimpan aktivitas.';
        if (window.showToast) window.showToast('Gagal', errMsg, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            updateModalSaveButtonState();
        }
        if (btnDraftAlt) btnDraftAlt.disabled = false;
    }
};

window.deleteEmployeeActivity = async function(id) {
    let act = activitiesList.find(a => String(a.id) === String(id));
    if (!act && currentWeeklyActivities && currentWeeklyActivities.length > 0) {
        act = currentWeeklyActivities.find(a => String(a.id) === String(id));
    }
    const title = act?.task_item_name || act?.task_name || act?.description || act?.activity_description || 'aktivitas ini';

    const confirmed = await showConfirmModal(`Apakah Anda yakin ingin menghapus catatan "${escapeHTML(title)}"?`, 'Hapus Aktivitas', 'danger');
    if (!confirmed) return;

    try {
        // Hapus foto terkait dari Google Drive di latar belakang (fire and forget)
        const photosToDelete = parseEvidencePhotos(act?.bukti_url || act?.evidence_url);
        photosToDelete.forEach(p => {
            if (p.fileId) deleteEmployeePhotoFromGoogleDrive(p.fileId);
        });

        await cfClient.deleteEmployeeActivity(id);
        if (window.showToast) window.showToast('Berhasil', 'Catatan aktivitas telah dihapus.', 'success');
        await loadEmployeeDayData();
    } catch (e) {
        console.error('[deleteEmployeeActivity] Error:', e);
        if (window.showToast) window.showToast('Gagal', e.message, 'error');
    }
};

window.deleteActivityFromModal = async function() {
    const actId = editingActivityId || document.getElementById('form-activity-id')?.value;
    if (!actId) return;

    let act = activitiesList.find(a => String(a.id) === String(actId));
    if (!act && currentWeeklyActivities && currentWeeklyActivities.length > 0) {
        act = currentWeeklyActivities.find(a => String(a.id) === String(actId));
    }
    const title = act?.task_item_name || act?.task_name || act?.description || act?.activity_description || 'aktivitas ini';

    const confirmed = await showConfirmModal(`Apakah Anda yakin ingin menghapus catatan "${escapeHTML(title)}"?`, 'Hapus Aktivitas', 'danger');
    if (!confirmed) return;

    window.closeActivityModal();

    try {
        await cfClient.deleteEmployeeActivity(actId);
        if (window.showToast) window.showToast('Berhasil', 'Catatan aktivitas telah dihapus.', 'success');
        await loadEmployeeDayData();
    } catch (e) {
        console.error('[deleteActivityFromModal] Error:', e);
        if (window.showToast) window.showToast('Gagal', e.message, 'error');
    }
};

// ============================================================================
// 10.3 MODAL KETIDAKHADIRAN PEGAWAI (SAKIT / CUTI / IZIN)
// ============================================================================

window.openEmployeeAbsenceModal = function(dateStr = null) {
    const targetDate = dateStr || selectedDate;
    const modal = document.getElementById('modal-employee-absence');
    if (!modal) return;

    const form = document.getElementById('form-employee-absence');
    if (form) form.reset();

    const idInput = document.getElementById('absence-form-id');
    const dateInput = document.getElementById('absence-form-date');
    const labelDate = document.getElementById('absence-form-date-label');
    const typeSelect = document.getElementById('absence-form-type');
    const notesText = document.getElementById('absence-form-notes');
    const btnDelete = document.getElementById('btn-delete-employee-absence');
    const submitLabel = document.getElementById('label-btn-submit-absence');

    if (dateInput) dateInput.value = targetDate;
    if (labelDate) {
        labelDate.textContent = `Hari Kerja: ${formatIndonesianDayDateCompact(targetDate)}`;
    }

    // Cari catatan existing untuk tanggal yang dipilih
    let existingAbsence = null;
    if (targetDate === selectedDate && currentDayAbsence) {
        existingAbsence = currentDayAbsence;
    } else if (weeklyAbsencesMap.has(targetDate)) {
        existingAbsence = weeklyAbsencesMap.get(targetDate);
    }

    if (existingAbsence) {
        if (idInput) idInput.value = existingAbsence.id || '';
        if (typeSelect) typeSelect.value = existingAbsence.jenis || 'Sakit';
        if (notesText) notesText.value = existingAbsence.alasan || '';
        if (btnDelete) btnDelete.classList.remove('hidden');
        if (submitLabel) submitLabel.textContent = 'Perbarui Keterangan';
    } else {
        if (idInput) idInput.value = '';
        if (typeSelect) typeSelect.value = 'Sakit';
        if (notesText) notesText.value = '';
        if (btnDelete) btnDelete.classList.add('hidden');
        if (submitLabel) submitLabel.textContent = 'Simpan Keterangan';
    }

    modal.classList.remove('hidden');
};

window.closeEmployeeAbsenceModal = function() {
    const modal = document.getElementById('modal-employee-absence');
    if (!modal) return;
    modal.classList.add('hidden');
};

window.submitEmployeeAbsence = async function(event) {
    if (event && event.preventDefault) event.preventDefault();

    const idVal = document.getElementById('absence-form-id')?.value || null;
    const dateVal = document.getElementById('absence-form-date')?.value || selectedDate;
    const typeVal = document.getElementById('absence-form-type')?.value || 'Sakit';
    const notesVal = document.getElementById('absence-form-notes')?.value?.trim() || '';

    if (!notesVal) {
        if (window.showToast) window.showToast('Perhatian', 'Keterangan alasan wajib diisi.', 'warning');
        return;
    }

    const btnSubmit = document.getElementById('btn-submit-employee-absence');
    if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.classList.remove('cursor-pointer');
        btnSubmit.classList.add('opacity-60', 'cursor-not-allowed');
    }

    try {
        const isPersonalMode = !isSupervisor || !isMonitoringMode;
        const targetGtk = isPersonalMode ? '' : (selectedEmployeeGtkId || '');

        const payload = {
            id: idVal || undefined,
            tanggal: dateVal,
            jenis: typeVal,
            alasan: notesVal,
            gtk_id: targetGtk || undefined
        };

        const res = await cfClient.saveEmployeeAbsence(payload);
        if (res && res.error) {
            throw new Error(res.error);
        }

        if (window.showToast) {
            window.showToast('Berhasil', `Keterangan ${typeVal} berhasil disimpan.`, 'success');
        }

        window.closeEmployeeAbsenceModal();
        await loadEmployeeDayData();
    } catch (e) {
        console.error('[submitEmployeeAbsence] Error:', e);
        if (window.showToast) {
            window.showToast('Gagal', e.message || 'Gagal menyimpan status ketidakhadiran.', 'error');
        }
    } finally {
        if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.classList.remove('opacity-60', 'cursor-not-allowed');
            btnSubmit.classList.add('cursor-pointer');
        }
    }
};

window.cancelEmployeeAbsence = async function() {
    const dateVal = document.getElementById('absence-form-date')?.value || selectedDate;
    let absId = document.getElementById('absence-form-id')?.value;

    if (!absId) {
        if (dateVal === selectedDate && currentDayAbsence?.id) {
            absId = currentDayAbsence.id;
        } else if (weeklyAbsencesMap.get(dateVal)?.id) {
            absId = weeklyAbsencesMap.get(dateVal).id;
        }
    }

    if (!absId) {
        if (window.showToast) window.showToast('Perhatian', 'Tidak ada data ketidakhadiran yang dapat dibatalkan.', 'warning');
        return;
    }

    const confirmed = (typeof showConfirmModal === 'function')
        ? await showConfirmModal('Batalkan keterangan ketidakhadiran pada tanggal ini? Anda dapat mencatat aktivitas jam kerja kembali.', 'Batalkan Status Ketidakhadiran', 'danger')
        : confirm('Batalkan status ketidakhadiran pada tanggal ini?');

    if (!confirmed) return;

    const btnDelete = document.getElementById('btn-delete-employee-absence');
    if (btnDelete) {
        btnDelete.disabled = true;
        btnDelete.classList.remove('cursor-pointer');
        btnDelete.classList.add('opacity-60', 'cursor-not-allowed');
    }

    try {
        const res = await cfClient.deleteEmployeeAbsence(absId);
        if (res && res.error) {
            throw new Error(res.error);
        }

        if (window.showToast) {
            window.showToast('Berhasil', 'Status ketidakhadiran berhasil dibatalkan.', 'success');
        }

        window.closeEmployeeAbsenceModal();
        await loadEmployeeDayData();
    } catch (e) {
        console.error('[cancelEmployeeAbsence] Error:', e);
        if (window.showToast) {
            window.showToast('Gagal', e.message || 'Gagal membatalkan status ketidakhadiran.', 'error');
        }
    } finally {
        if (btnDelete) {
            btnDelete.disabled = false;
            btnDelete.classList.remove('opacity-60', 'cursor-not-allowed');
            btnDelete.classList.add('cursor-pointer');
        }
    }
};

// ============================================================================
// 10.4 INTEGRASI HARI LIBUR KALENDER AGENDA (0 Kuota Firestore & Terpisah dari Libur Guru)
// Penentuan hari libur pegawai berlandaskan Kalender Agenda (calendar_events D1)
// serta Hari Libur Nasional resmi (DataHolidays) tanpa mengikutsertakan aturan/heuristik guru.
// ============================================================================

const agendaHolidaysCache = {};

/**
 * Mengambil daftar hari libur dari Kalender Agenda (D1) dan DataHolidays untuk rentang tanggal
 */
async function fetchAgendaHolidaysForRange(fromStr, toStr) {
    if (!fromStr || !toStr) return [];
    
    const fromParts = fromStr.split('-').map(Number);
    const toParts = toStr.split('-').map(Number);
    if (fromParts.length < 2 || toParts.length < 2) return [];

    const monthsToFetch = new Set();
    let curY = fromParts[0];
    let curM = fromParts[1];
    const endY = toParts[0];
    const endM = toParts[1];

    while (curY < endY || (curY === endY && curM <= endM)) {
        monthsToFetch.add(`${curY}-${String(curM).padStart(2, '0')}`);
        curM++;
        if (curM > 12) {
            curM = 1;
            curY++;
        }
    }

    for (const ym of monthsToFetch) {
        if (!agendaHolidaysCache[ym]) {
            const [y, m] = ym.split('-').map(Number);
            let events = [];
            try {
                if (typeof cfClient !== 'undefined' && typeof cfClient.getCalendarEvents === 'function') {
                    const res = await cfClient.getCalendarEvents(y, m);
                    const raw = (res && Array.isArray(res.data)) ? res.data : (Array.isArray(res) ? res : []);
                    events = raw.filter(ev => {
                        const cat = (ev.category || ev.type || '').toLowerCase();
                        const col = (ev.color || '').toLowerCase();
                        return cat === 'libur' || col === 'rose' || Boolean(ev.isNationalHoliday);
                    });
                }
            } catch (err) {
                console.warn(`[AgendaPegawai] Gagal memuat calendar_events untuk ${ym}:`, err);
                events = [];
            }

            // Integrasikan DataHolidays (Libur Nasional resmi SKB 3 Menteri)
            if (typeof window !== 'undefined' && window.DataHolidays && typeof window.DataHolidays.getNationalHolidays === 'function') {
                try {
                    const natHolidays = window.DataHolidays.getNationalHolidays(y);
                    const prefix = `${ym}-`;
                    const mHols = natHolidays.filter(h => h.date && h.date.startsWith(prefix));
                    mHols.forEach(h => {
                        const exists = events.some(e => {
                            const edStr = (e.date || '').substring(0, 10);
                            return edStr === h.date && (e.title || '').trim().toLowerCase() === (h.title || '').trim().toLowerCase();
                        });
                        if (!exists) {
                            events.push({
                                ...h,
                                category: 'libur',
                                type: 'libur',
                                color: 'rose'
                            });
                        }
                    });
                } catch (dhErr) {
                    console.warn('[AgendaPegawai] Gagal integrasi DataHolidays:', dhErr);
                }
            }

            agendaHolidaysCache[ym] = events;
        }
    }

    return Array.from(monthsToFetch).flatMap(ym => agendaHolidaysCache[ym] || []);
}
window.fetchAgendaHolidaysForRange = fetchAgendaHolidaysForRange;

/**
 * Cek apakah suatu tanggal merupakan hari libur di Kalender Agenda
 * @param {string} dateStr - Format YYYY-MM-DD
 * @returns {object|null} { isHoliday: true, title, isNationalHoliday, isCutiBersama }
 */
function getAgendaHolidayForDate(dateStr) {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
    const [y, m] = dateStr.split('-');
    const ym = `${y}-${m}`;
    const list = agendaHolidaysCache[ym] || [];

    for (const ev of list) {
        const s = (ev.date || '').substring(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) continue;
        let e = ev.endDate ? String(ev.endDate).substring(0, 10) : (ev.time && /^\d{4}-\d{2}-\d{2}$/.test(ev.time) ? ev.time : s);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(e) || e < s) e = s;

        if (dateStr >= s && dateStr <= e) {
            const cat = (ev.category || ev.type || '').toLowerCase();
            const col = (ev.color || '').toLowerCase();
            if (cat === 'libur' || col === 'rose' || ev.isNationalHoliday) {
                return {
                    isHoliday: true,
                    title: ev.title || 'Hari Libur Resmi Agenda',
                    isNationalHoliday: Boolean(ev.isNationalHoliday),
                    isCutiBersama: Boolean(ev.isCutiBersama),
                    description: ev.description || ''
                };
            }
        }
    }

    // Fallback instan ke DataHolidays jika cache kalender D1 belum terisi
    if (typeof window !== 'undefined' && window.DataHolidays && typeof window.DataHolidays.getHolidayForDate === 'function') {
        const dhHol = window.DataHolidays.getHolidayForDate(dateStr);
        if (dhHol) {
            return {
                isHoliday: true,
                title: dhHol.title || 'Libur Nasional',
                isNationalHoliday: Boolean(dhHol.isNationalHoliday),
                isCutiBersama: Boolean(dhHol.isCutiBersama)
            };
        }
    }

    return null;
}
window.getAgendaHolidayForDate = getAgendaHolidayForDate;

/**
 * Menghitung penyesuaian target mingguan berdasarkan hari libur di Kalender Agenda
 * @param {Array<string>} weekDays - 5 hari kerja (Senin s.d. Jumat)
 */
function calculateAdjustedWeeklyTarget(weekDays) {
    if (!Array.isArray(weekDays) || weekDays.length === 0) {
        return {
            workingDaysCount: 5,
            targetMinutes: 2250,
            targetHours: 37.5,
            targetHoursStr: '37,5',
            holidays: []
        };
    }

    const holidays = [];
    let workingDaysCount = 0;

    weekDays.forEach(dStr => {
        const hol = getAgendaHolidayForDate(dStr);
        if (hol) {
            holidays.push({
                date: dStr,
                title: hol.title,
                isHoliday: true,
                isNationalHoliday: hol.isNationalHoliday,
                isCutiBersama: hol.isCutiBersama
            });
        } else {
            workingDaysCount++;
        }
    });

    const targetMinutes = workingDaysCount * 450;
    const targetHours = targetMinutes / 60;
    const targetHoursStr = (targetHours % 1 === 0)
        ? String(targetHours)
        : targetHours.toFixed(1).replace('.', ',');

    return {
        workingDaysCount,
        targetMinutes,
        targetHours,
        targetHoursStr,
        holidays
    };
}
window.calculateAdjustedWeeklyTarget = calculateAdjustedWeeklyTarget;

// 10.5 Helper Tanggal & Kendali Mingguan (SSOT terdefinisi pada Bagian 3.5)

/**
 * Memuat Akumulasi Data Mingguan Staf (POV Pegawai)
 */
async function loadEmployeeWeeklyData() {
    const strip = document.getElementById('weekly-employee-strip');
    const rangeLabel = document.getElementById('weekly-strip-range-label');
    const hoursText = document.getElementById('weekly-strip-hours-text');
    const statusBadge = document.getElementById('weekly-strip-status-badge');
    const progressBar = document.getElementById('weekly-strip-progress-bar');
    const daysContainer = document.getElementById('weekly-strip-days-container');

    if (!strip) return;

    const myWeekSeq = ++_weekLoadSeq;
    const days = getWorkWeekDays(selectedDate);
    const mondayStr = days[0];
    const fridayStr = days[4];
    const weekRangeFormatted = formatWeekRange(mondayStr, fridayStr);

    if (rangeLabel) {
        rangeLabel.textContent = weekRangeFormatted;
    }

    const headerWeekEl = document.getElementById('header-week-label');
    if (headerWeekEl) {
        headerWeekEl.textContent = weekRangeFormatted;
    }

    // Ambil hari libur kalender agenda untuk rentang sepekan
    await fetchAgendaHolidaysForRange(mondayStr, fridayStr);
    if (myWeekSeq !== _weekLoadSeq) return;

    const adjustedTarget = calculateAdjustedWeeklyTarget(days);
    const TARGET_MINUTES = adjustedTarget.targetMinutes;
    const TARGET_HOURS_STR = adjustedTarget.targetHoursStr;
    const holidayCount = adjustedTarget.holidays.length;

    // Perbarui badge target di header halaman
    const headerTargetBadge = document.getElementById('header-weekly-target-badge');
    const headerTargetText = document.getElementById('header-weekly-target-text');
    if (headerTargetText) {
        headerTargetText.textContent = `Target ${TARGET_HOURS_STR} Jam/Minggu${holidayCount > 0 ? ` (${holidayCount} Hari Libur)` : ''}`;
        if (headerTargetBadge) {
            headerTargetBadge.title = `Target Kinerja Pekan Ini: ${TARGET_HOURS_STR} Jam (${TARGET_MINUTES} Menit) disesuaikan dengan ${holidayCount} hari libur di Kalender Agenda`;
        }
    }

    try {
        const isPersonalMode = !isSupervisor || !isMonitoringMode;
        const targetGtk = isPersonalMode ? '' : (selectedEmployeeGtkId || '');
        const params = { from: mondayStr, to: fridayStr };
        if (isPersonalMode) {
            params.mode = 'personal';
            params.self = 'true';
        } else if (targetGtk) {
            params.gtk_id = targetGtk;
        }

        const [actOutcome, absOutcome] = await Promise.allSettled([
            cfClient.getEmployeeActivities(params),
            cfClient.getEmployeeAbsences(params)
        ]);
        if (myWeekSeq !== _weekLoadSeq) return;

        let acts = [];
        if (actOutcome.status === 'fulfilled') {
            const res = actOutcome.value;
            acts = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
        } else {
            console.warn('[loadEmployeeWeeklyData] Gagal memuat aktivitas:', actOutcome.reason);
            acts = [];
        }
        currentWeeklyActivities = acts;

        if (absOutcome.status === 'fulfilled') {
            const absRes = absOutcome.value;
            const absData = Array.isArray(absRes?.data) ? absRes.data : (Array.isArray(absRes) ? absRes : []);
            weeklyAbsencesMap.clear();
            absData.forEach(abs => {
                if (abs.tanggal) {
                    weeklyAbsencesMap.set(abs.tanggal, abs);
                }
            });
        } else {
            console.warn('[loadEmployeeWeeklyData] Gagal memuat ketidakhadiran mingguan:', absOutcome.reason);
            weeklyAbsencesMap.clear();
        }

        const dayMinutesMap = {};
        days.forEach(d => { dayMinutesMap[d] = 0; });

        let totalWeekMinutes = 0;
        acts.forEach(a => {
            const tgl = a.tanggal || a.date;
            const eff = Number(a.durasi_efektif_menit) || 0;
            if (dayMinutesMap[tgl] !== undefined) {
                dayMinutesMap[tgl] += eff;
            }
            totalWeekMinutes += eff;
        });

        const percent = TARGET_MINUTES > 0 ? Math.min(100, Math.round((totalWeekMinutes / TARGET_MINUTES) * 100)) : 100;
        const hoursNum = (totalWeekMinutes / 60).toFixed(1);

        if (hoursText) {
            hoursText.textContent = `${hoursNum} / ${TARGET_HOURS_STR} Jam (${percent}%)`;
        }

        if (progressBar) {
            progressBar.style.width = `${percent}%`;
        }

        if (statusBadge) {
            if (totalWeekMinutes >= TARGET_MINUTES) {
                statusBadge.textContent = 'Target Tercapai';
                statusBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300';
            } else if (percent >= 70) {
                const remHours = ((TARGET_MINUTES - totalWeekMinutes) / 60).toFixed(1).replace('.', ',');
                statusBadge.textContent = `${remHours} Jam Menuju Target`;
                statusBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300';
            } else {
                statusBadge.textContent = 'Sedang Berjalan';
                statusBadge.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300';
            }
        }

        if (daysContainer) {
            const dayNames = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum'];
            daysContainer.innerHTML = days.map((dStr, idx) => {
                const isSelected = (dStr === selectedDate);
                const min = dayMinutesMap[dStr] || 0;
                const h = (min / 60).toFixed(1);
                const isFull = min >= 450;
                const dNum = dStr.split('-')[2];
                const hol = getAgendaHolidayForDate(dStr);
                const absence = weeklyAbsencesMap.get(dStr);

                let bgClass = '';
                let subLabel = `${h}j`;
                let tooltip = `Buka agenda ${dStr}`;

                if (hol) {
                    tooltip = `${dayNames[idx]}, ${dStr} - Hari Libur Resmi Agenda: ${hol.title}`;
                    if (isSelected) {
                        bgClass = 'bg-rose-600 text-white shadow-md ring-2 ring-rose-500/50';
                        subLabel = min > 0 ? `${h}j` : 'Libur';
                    } else if (min > 0) {
                        bgClass = 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-800/60';
                    } else {
                        bgClass = 'bg-rose-50/70 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border border-rose-200/60 dark:border-rose-900/40';
                        subLabel = '<span class="text-[9px] font-extrabold uppercase">Libur</span>';
                    }
                } else if (absence) {
                    tooltip = `${dayNames[idx]}, ${dStr} - Keterangan Resmi: ${absence.jenis} (${absence.alasan || 'Sah'})`;
                    if (isSelected) {
                        bgClass = 'bg-amber-600 text-white shadow-md ring-2 ring-amber-500/50';
                        subLabel = min > 0 ? `${h}j` : absence.jenis;
                    } else if (min > 0) {
                        bgClass = 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800/60';
                        subLabel = `${h}j (${absence.jenis})`;
                    } else {
                        bgClass = 'bg-amber-50/80 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/40';
                        subLabel = `<span class="text-[9px] font-extrabold uppercase">${escapeHTML(absence.jenis)}</span>`;
                    }
                } else if (isSelected) {
                    bgClass = 'bg-emerald-600 text-white shadow-md ring-2 ring-emerald-500/50';
                } else if (isFull) {
                    bgClass = 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/40';
                } else {
                    bgClass = 'bg-slate-50 dark:bg-slate-800/70 text-slate-700 dark:text-slate-200 border border-slate-200/60 dark:border-slate-700/60';
                }

                const iconAbsence = (!hol && absence) ? (absence.jenis === 'Sakit' ? '<i class="fa-solid fa-hospital-user text-[8px] text-amber-600 dark:text-amber-400"></i>' : '<i class="fa-solid fa-calendar-xmark text-[8px] text-amber-600 dark:text-amber-400"></i>') : '';

                return `
                    <button type="button" onclick="window.selectEmployeeDay('${dStr}')" class="p-2 rounded-xl text-center transition-all hover:scale-105 active:scale-95 ${bgClass}" title="${escapeHTML(tooltip)}">
                        <div class="text-[10px] font-bold opacity-80 flex items-center justify-center gap-1">
                            <span>${dayNames[idx]} (${dNum})</span>
                            ${hol ? '<i class="fa-solid fa-umbrella-beach text-[8px]"></i>' : iconAbsence}
                        </div>
                        <div class="text-xs font-black mt-0.5">${subLabel}</div>
                    </button>
                `;
            }).join('');
        }

        // Render Matriks Kinerja Mingguan (POV Pegawai) dengan target acuan dinamis
        renderEmployeeWeeklyMatrix(days, acts, dayMinutesMap, totalWeekMinutes, adjustedTarget);

    } catch (e) {
        console.warn('[loadEmployeeWeeklyData] Gagal memuat data mingguan:', e);
        const matrixBody = document.getElementById('table-employee-weekly-matrix-body');
        if (matrixBody) {
            matrixBody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-rose-500 italic">Gagal memuat matriks mingguan.</td></tr>';
        }
    }
}

/**
 * Render Visual Ribbon Timeline pada Kolom 2 Matriks Kinerja Mingguan (07:30 – 15:30)
 */
function renderWeeklyMatrixTimeline(dayActs, dStr, idx) {
    const agendaHoliday = (typeof getAgendaHolidayForDate === 'function') ? getAgendaHolidayForDate(dStr) : null;

    // Jika hari libur agenda dan tidak ada aktivitas, render pita hari libur
    if ((!dayActs || dayActs.length === 0) && agendaHoliday) {
        return `
            <div class="w-full">
                <div class="w-full h-7 bg-rose-50/80 dark:bg-rose-950/30 rounded-lg overflow-hidden flex items-center justify-center border border-rose-200/80 dark:border-rose-900/50 shadow-2xs px-2.5 text-rose-700 dark:text-rose-300 text-xs font-bold gap-1.5" title="Hari Libur Agenda: ${escapeHTML(agendaHoliday.title || 'Libur Resmi')}">
                    <i class="fa-solid fa-umbrella-beach text-rose-500 text-[11px]"></i>
                    <span class="truncate">Hari Libur Agenda (${escapeHTML(agendaHoliday.title || 'Libur Resmi')})</span>
                </div>
            </div>
        `;
    }

    // Jika pegawai berstatus tidak melaksanakan tugas (Sakit / Cuti / Izin) dan tidak ada aktivitas
    const matrixAbsence = weeklyAbsencesMap.get(dStr);
    if ((!dayActs || dayActs.length === 0) && matrixAbsence) {
        const iconName = matrixAbsence.jenis === 'Sakit' ? 'fa-hospital-user' : (matrixAbsence.jenis === 'Cuti' ? 'fa-plane-departure' : 'fa-clipboard-user');
        return `
            <div class="w-full">
                <div class="w-full h-7 bg-amber-50/90 dark:bg-amber-950/40 rounded-lg overflow-hidden flex items-center justify-between border border-amber-300/80 dark:border-amber-800/60 shadow-2xs px-2.5 text-amber-900 dark:text-amber-200 text-xs font-bold gap-1.5" title="Keterangan Sah: ${escapeHTML(matrixAbsence.jenis)} - ${escapeHTML(matrixAbsence.alasan || '-')}">
                    <div class="flex items-center gap-1.5 truncate">
                        <i class="fa-solid ${iconName} text-amber-600 dark:text-amber-400 text-[11px] shrink-0"></i>
                        <span class="truncate">Tidak Melaksanakan Tugas: <b>${escapeHTML(matrixAbsence.jenis)}</b></span>
                        <span class="text-[10px] text-amber-800/80 dark:text-amber-300/80 font-normal truncate">(${escapeHTML(matrixAbsence.alasan || 'Keterangan resmi')})</span>
                    </div>
                    <span class="px-1.5 py-0.2 rounded text-[9px] font-black uppercase bg-amber-200/80 dark:bg-amber-900/60 text-amber-900 dark:text-amber-100 shrink-0">Sah</span>
                </div>
            </div>
        `;
    }

    const DAY_START = 450; // 07:30 (menit dari 00:00)
    const DAY_END   = 930; // 15:30
    const TOTAL_SPAN = DAY_END - DAY_START; // 480 menit
    const REST_START = 750; // 12:30
    const REST_END   = 780; // 13:00

    const sorted = [...(dayActs || [])].sort((a, b) => {
        const sA = a.jam_mulai || a.start_time || '';
        const sB = b.jam_mulai || b.start_time || '';
        return sA.localeCompare(sB);
    });

    const coveredIntervals = [];
    let blocksHtml = '';

    sorted.forEach(act => {
        const startTime = act.jam_mulai || act.start_time;
        const endTime = act.jam_selesai || act.end_time;
        if (!startTime || !endTime) return;

        const [sh, sm] = startTime.split(':').map(Number);
        const [eh, em] = endTime.split(':').map(Number);
        if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return;

        const startMin = Math.max(DAY_START, sh * 60 + sm);
        const endMin = Math.min(DAY_END, eh * 60 + em);

        if (startMin < endMin) {
            coveredIntervals.push({ start: startMin, end: endMin });

            const activitySegments = [];
            const crossesRest = (startMin < REST_END && endMin > REST_START);

            if (startMin < REST_START && endMin > REST_END) {
                activitySegments.push({ sMin: startMin, eMin: REST_START });
                activitySegments.push({ sMin: REST_END, eMin: endMin });
            } else if (startMin < REST_START && endMin > REST_START) {
                activitySegments.push({ sMin: startMin, eMin: Math.min(endMin, REST_START) });
            } else if (startMin < REST_END && endMin > REST_END) {
                activitySegments.push({ sMin: Math.max(startMin, REST_END), eMin: endMin });
            } else if (startMin >= REST_START && endMin <= REST_END) {
                // Berada tepat di dalam jam istirahat
            } else {
                activitySegments.push({ sMin: startMin, eMin: endMin });
            }

            const titleText = escapeHTML(act.task_item_name || act.task_name || act.activity_description || act.description || 'Aktivitas Pokok');
            const descText = act.description && act.task_item_name && act.description !== act.task_item_name
                ? `<p class="text-[11px] text-slate-300 mt-1 line-clamp-2 leading-relaxed">${escapeHTML(act.description)}</p>`
                : '';
            const locationText = act.location 
                ? `<div class="text-[10px] text-slate-300 flex items-center gap-1.5 mt-1 truncate"><i class="fa-solid fa-location-dot text-emerald-400 text-[10px] shrink-0"></i> <span class="truncate">${escapeHTML(act.location)}</span></div>`
                : '';
            const outputVal = act.output || act.output_evidence || act.output_description || act.output_summary || '';
            const outputText = outputVal
                ? `<div class="text-[10px] text-slate-300 flex items-center gap-1.5 mt-0.5 truncate"><i class="fa-solid fa-box-archive text-blue-400 text-[10px] shrink-0"></i> <span class="truncate">Hasil: ${escapeHTML(outputVal)}</span></div>`
                : '';
            const isOutside = Boolean(act.is_outside_duty || act.is_official_duty || act.is_dinas_luar);
            const dutyBadge = isOutside
                ? `<span class="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30"><i class="fa-solid fa-car-side text-[8px]"></i> Dinas Luar</span>`
                : '';
            const restBreakBadge = crossesRest
                ? `<span class="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-400/20 text-amber-300 border border-amber-400/30"><i class="fa-solid fa-mug-hot text-[8px]"></i> Jeda Istirahat (12:30–13:00)</span>`
                : '';

            const effMin = act.durasi_efektif_menit != null ? act.durasi_efektif_menit : calculateEffectiveMinutes(act.jam_mulai || act.start_time, act.jam_selesai || act.end_time);
            const totalDurMin = (eh * 60 + em) - (sh * 60 + sm);

            activitySegments.forEach((seg, segIdx) => {
                const subStart = seg.sMin;
                const subEnd = seg.eMin;
                if (subStart >= subEnd) return;

                const leftPct = ((subStart - DAY_START) / TOTAL_SPAN) * 100;
                const widthPct = ((subEnd - subStart) / TOTAL_SPAN) * 100;

                // Penentuan orientasi tooltip (baris pertama pop-down agar tidak terpotong header tabel, baris lain pop-up)
                const isTopRow = (idx === 0);
                const tooltipPosClass = isTopRow ? 'top-full mt-2' : 'bottom-full mb-2';
                const arrowPosClass = isTopRow 
                    ? 'bottom-full border-b-slate-900 border-t-transparent' 
                    : 'top-full border-t-slate-900 border-b-transparent';

                let tooltipAlignClass = 'left-1/2 -translate-x-1/2';
                let arrowAlignClass = 'left-1/2 -translate-x-1/2';
                if (leftPct > 65) {
                    tooltipAlignClass = 'right-0';
                    arrowAlignClass = 'right-5';
                } else if (leftPct < 15) {
                    tooltipAlignClass = 'left-0';
                    arrowAlignClass = 'left-5';
                }

                const timeLabel = (activitySegments.length > 1 && segIdx > 0) ? '13:00' : startTime;

                blocksHtml += `
                    <div onclick="window.editEmployeeActivity('${escapeHTML(String(act.id))}')"
                         role="button"
                         tabindex="0"
                         onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.editEmployeeActivity('${escapeHTML(String(act.id))}');}"
                         class="absolute h-full bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 transition-all cursor-pointer group rounded-xs border-r border-white/20 last:border-r-0 z-20 hover:z-40 hover:shadow-lg hover:brightness-110 flex items-center justify-center overflow-visible" 
                         style="left: ${leftPct}%; width: ${widthPct}%;" 
                         title="${escapeHTML(startTime)} - ${escapeHTML(endTime)}: ${titleText} (Klik untuk edit)">
                        
                        ${widthPct >= 10 ? `
                            <span class="text-[9px] font-black text-slate-950 px-1 truncate pointer-events-none select-none">
                                ${escapeHTML(timeLabel)}
                            </span>
                        ` : ''}

                        <!-- Rich Hover Popover Tooltip -->
                        <div class="absolute ${tooltipPosClass} ${tooltipAlignClass} hidden group-hover:flex flex-col w-64 sm:w-72 p-2.5 bg-slate-900/95 text-white rounded-xl shadow-2xl border border-slate-700/80 backdrop-blur-md pointer-events-none transition-all duration-150 z-50 text-left">
                            <div class="flex items-center justify-between gap-1 pb-1 border-b border-slate-800">
                                <span class="font-mono text-xs font-black text-emerald-400 flex items-center gap-1">
                                    <i class="fa-regular fa-clock text-[10px]"></i> ${escapeHTML(startTime)} – ${escapeHTML(endTime)}
                                </span>
                                <span class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 shrink-0">
                                    ${totalDurMin}m (${effMin}m efektif)
                                </span>
                            </div>
                            <div class="mt-1 font-bold text-xs text-white leading-snug line-clamp-2">
                                ${titleText}
                            </div>
                            ${descText}
                            ${locationText}
                            ${outputText}
                            <div class="mt-1.5 pt-1 border-t border-slate-800 flex items-center justify-between text-[9px] flex-wrap gap-1">
                                <div class="flex items-center gap-1.5">
                                    ${dutyBadge}
                                    ${restBreakBadge}
                                    ${(() => {
                                        const pList = parseEvidencePhotos(act.bukti_url || act.evidence_url);
                                        return pList.length > 0 ? `<span class="inline-flex items-center gap-1 text-[9px] text-emerald-400 font-semibold"><i class="fa-solid fa-camera text-[8px]"></i> ${pList.length} Foto</span>` : '';
                                    })()}
                                </div>
                                <span class="text-emerald-400 font-semibold flex items-center gap-1 ml-auto">
                                    <i class="fa-solid fa-pen-to-square text-[8px]"></i> Klik untuk edit
                                </span>
                            </div>
                            <div class="absolute ${arrowPosClass} ${arrowAlignClass} border-4 border-transparent"></div>
                        </div>
                    </div>
                `;
            });
        }
    });

    // Bar Istirahat Resmi (12:30 - 13:00) dengan z-30 agar tidak tertutup
    const restLeft = ((REST_START - DAY_START) / TOTAL_SPAN) * 100;
    const restWidth = ((REST_END - REST_START) / TOTAL_SPAN) * 100;
    const isTopRowRest = (idx === 0);
    const restTooltipPos = isTopRowRest ? 'top-full mt-2' : 'bottom-full mb-2';
    const restArrowPos = isTopRowRest ? 'bottom-full border-b-slate-900 border-t-transparent' : 'top-full border-t-slate-900 border-b-transparent';

    blocksHtml += `
        <div class="absolute h-full bg-amber-400/95 hover:bg-amber-400 z-30 flex items-center justify-center cursor-default group/rest transition-colors border-x border-amber-500/50 shadow-xs overflow-visible" style="left: ${restLeft}%; width: ${restWidth}%;" title="Waktu Istirahat (12:30 - 13:00)">
            <span class="text-[8px] font-black text-amber-950 uppercase tracking-tighter px-0.5 truncate select-none">Istirahat</span>
            <div class="absolute ${restTooltipPos} left-1/2 -translate-x-1/2 hidden group-hover/rest:flex flex-col w-52 p-2 bg-slate-900/95 text-white rounded-lg shadow-xl border border-slate-700 pointer-events-none z-50 text-left text-[10px]">
                <div class="font-mono font-bold text-amber-400 flex items-center gap-1"><i class="fa-solid fa-mug-hot"></i> 12:30 – 13:00 WITA</div>
                <div class="text-slate-300 mt-0.5">Waktu Istirahat Resmi (Tidak dihitung durasi kerja).</div>
                <div class="absolute ${restArrowPos} left-1/2 -translate-x-1/2 border-4 border-transparent"></div>
            </div>
        </div>
    `;

    // Kalkulasi celah waktu belum terisi (Gaps)
    let merged = [];
    const allIntervals = [...coveredIntervals, { start: REST_START, end: REST_END }].sort((a, b) => a.start - b.start);
    for (let cur of allIntervals) {
        if (!merged.length) {
            merged.push({ ...cur });
        } else {
            let last = merged[merged.length - 1];
            if (cur.start <= last.end) {
                last.end = Math.max(last.end, cur.end);
            } else {
                merged.push({ ...cur });
            }
        }
    }

    const gaps = [];
    let curTime = DAY_START;
    merged.forEach(m => {
        if (m.start > curTime) {
            gaps.push({ start: curTime, end: m.start });
        }
        curTime = Math.max(curTime, m.end);
    });
    if (curTime < DAY_END) {
        gaps.push({ start: curTime, end: DAY_END });
    }

    // Render blok celah kosong yang dapat diklik langsung
    gaps.forEach(g => {
        const gLeft = ((g.start - DAY_START) / TOTAL_SPAN) * 100;
        const gWidth = ((g.end - g.start) / TOTAL_SPAN) * 100;
        const gStartStr = `${String(Math.floor(g.start / 60)).padStart(2, '0')}:${String(g.start % 60).padStart(2, '0')}`;
        const gEndStr = `${String(Math.floor(g.end / 60)).padStart(2, '0')}:${String(g.end % 60).padStart(2, '0')}`;
        const gDuration = g.end - g.start;
        const isTopGap = (idx === 0);
        const gapTooltipPos = isTopGap ? 'top-full mt-2' : 'bottom-full mb-2';
        const gapArrowPos = isTopGap ? 'bottom-full border-b-slate-900 border-t-transparent' : 'top-full border-t-slate-900 border-b-transparent';

        blocksHtml += `
            <div onclick="window.addActivityForDate('${dStr}', '${gStartStr}')"
                 role="button"
                 tabindex="0"
                 class="absolute h-full bg-slate-200/40 dark:bg-slate-700/25 hover:bg-emerald-100/50 dark:hover:bg-emerald-950/30 border-r border-dashed border-slate-300 dark:border-slate-600 transition-colors cursor-pointer group/gap z-0 flex items-center justify-center overflow-visible"
                 style="left: ${gLeft}%; width: ${gWidth}%;"
                 title="Celah Belum Terisi: ${gStartStr} - ${gEndStr} (${gDuration}m) - Klik untuk catat">
                <div class="absolute ${gapTooltipPos} left-1/2 -translate-x-1/2 hidden group-hover/gap:flex flex-col w-56 p-2 bg-slate-900/95 text-white rounded-lg shadow-xl border border-slate-700 pointer-events-none z-50 text-left text-[10px]">
                    <div class="font-mono font-bold text-amber-400 flex items-center gap-1">
                        <i class="fa-solid fa-triangle-exclamation"></i> Belum Terisi: ${gStartStr} – ${gEndStr}
                    </div>
                    <div class="text-slate-300 mt-0.5">${gDuration} menit belum tercatat. Klik untuk mencatat aktivitas di jam ini.</div>
                    <div class="absolute ${gapArrowPos} left-1/2 -translate-x-1/2 border-4 border-transparent"></div>
                </div>
            </div>
        `;
    });

    // Format keterangan jam belum terisi di bawah ribbon (HANYA tampil jika hari memiliki aktivitas namun menyisakan celah jam kerja, dan BUKAN hari libur agenda)
    let gapSummaryHtml = '';
    if (dayActs && dayActs.length > 0 && gaps.length > 0 && !agendaHoliday) {
        const gapTexts = gaps.map(g => {
            const shStr = `${String(Math.floor(g.start / 60)).padStart(2, '0')}:${String(g.start % 60).padStart(2, '0')}`;
            const ehStr = `${String(Math.floor(g.end / 60)).padStart(2, '0')}:${String(g.end % 60).padStart(2, '0')}`;
            return `${shStr}–${ehStr}`;
        }).join(', ');

        const totalGapMin = gaps.reduce((acc, g) => acc + (g.end - g.start), 0);
        const gapHourStr = (totalGapMin / 60).toFixed(1);
        const firstGapStart = `${String(Math.floor(gaps[0].start / 60)).padStart(2, '0')}:${String(gaps[0].start % 60).padStart(2, '0')}`;

        gapSummaryHtml = `
            <div class="flex items-center justify-between gap-1 text-[10px] mt-0.5 flex-wrap">
                <span class="text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1">
                    <i class="fa-solid fa-triangle-exclamation text-[9px] text-amber-500"></i>
                    Belum terisi: <b class="font-bold font-mono">${gapTexts}</b> (${gapHourStr} Jam)
                </span>
                <button type="button" onclick="window.addActivityForDate('${dStr}', '${firstGapStart}')" class="font-bold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 ml-auto">
                    <i class="fa-solid fa-plus text-[9px]"></i> Catat Jam Ini
                </button>
            </div>
        `;
    }

    return `
        <div class="w-full">
            <div class="w-full h-7 bg-slate-100 dark:bg-slate-800/90 rounded-lg overflow-visible flex relative border border-slate-200/80 dark:border-slate-700/80 shadow-xs">
                ${blocksHtml}
            </div>
            ${gapSummaryHtml}
        </div>
    `;
}

/**
 * Render Matriks Kinerja Mingguan Pegawai (Hari & Waktu)
 */
function renderEmployeeWeeklyMatrix(days, acts, dayMinutesMap, totalWeekMinutes, adjustedTarget) {
    const tbody = document.getElementById('table-employee-weekly-matrix-body');
    const tfoot = document.getElementById('table-employee-weekly-matrix-foot');
    if (!tbody) return;

    const dayNamesFull = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
    const TARGET_DAILY_MINUTES = 450; // 7,5 jam
    const TARGET_WEEKLY_MINUTES = (adjustedTarget && typeof adjustedTarget.targetMinutes === 'number') 
        ? adjustedTarget.targetMinutes 
        : (37.5 * 60); // 2250 menit
    const targetWeeklyHours = adjustedTarget?.targetHours || (TARGET_WEEKLY_MINUTES / 60).toFixed(1);
    const workingDaysCount = adjustedTarget?.workingDays != null ? adjustedTarget.workingDays : 5;
    const holidayDaysCount = adjustedTarget?.holidayDays != null ? adjustedTarget.holidayDays : 0;

    const actsByDay = {};
    days.forEach(d => { actsByDay[d] = []; });
    (acts || []).forEach(a => {
        const tgl = a.tanggal || a.date;
        if (actsByDay[tgl]) {
            actsByDay[tgl].push(a);
        }
    });

    days.forEach(d => {
        actsByDay[d].sort((a, b) => {
            const startA = a.jam_mulai || a.start_time || '';
            const startB = b.jam_mulai || b.start_time || '';
            return startA.localeCompare(startB);
        });
    });

    const rowsHtml = days.map((dStr, idx) => {
        const isSelected = (dStr === selectedDate);
        const dayMinutes = dayMinutesMap[dStr] || 0;
        const dayHours = (dayMinutes / 60).toFixed(1);
        const dayActs = actsByDay[dStr] || [];
        const percent = Math.min(100, Math.round((dayMinutes / TARGET_DAILY_MINUTES) * 100));
        const agendaHoliday = (typeof getAgendaHolidayForDate === 'function') ? getAgendaHolidayForDate(dStr) : null;

        // Format tanggal hari: versi compact 1 baris, e.g. "Senin, 21 Sep"
        const compactDayDate = formatIndonesianDayDateCompact(dStr);
        const formattedDate = formatIndonesianDateFull(dStr);

        // Kolom 2: Timeline Aktivitas (07:30 - 15:30) & Status Celah Jam Kerja
        const timelineHtml = renderWeeklyMatrixTimeline(dayActs, dStr, idx);

        // Status Badge Acuan
        let statusBadgeHtml = '';
        const matrixAbsence = weeklyAbsencesMap.get(dStr);

        if (agendaHoliday) {
            if (dayMinutes > 0) {
                statusBadgeHtml = `
                    <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800" title="${escapeHTML(agendaHoliday.title || 'Hari Libur Resmi')} - Terlaksana ${dayHours} Jam">
                        <i class="fa-solid fa-calendar-check mr-1 text-[9px]"></i> Libur (${dayHours}j Terlaksana)
                    </span>
                `;
            } else {
                statusBadgeHtml = `
                    <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800" title="${escapeHTML(agendaHoliday.title || 'Hari Libur Resmi Agenda')}">
                        <i class="fa-solid fa-umbrella-beach mr-1 text-[9px]"></i> Libur Resmi
                    </span>
                `;
            }
        } else if (matrixAbsence) {
            if (dayMinutes > 0) {
                statusBadgeHtml = `
                    <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-800" title="${escapeHTML(matrixAbsence.jenis)} - ${dayHours}j Terlaksana">
                        <i class="fa-solid fa-hospital-user mr-1 text-[9px]"></i> ${escapeHTML(matrixAbsence.jenis)} (${dayHours}j)
                    </span>
                `;
            } else {
                statusBadgeHtml = `
                    <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-800" title="${escapeHTML(matrixAbsence.jenis)}: ${escapeHTML(matrixAbsence.alasan || '-')}">
                        <i class="fa-solid fa-hospital-user mr-1 text-[9px]"></i> ${escapeHTML(matrixAbsence.jenis)} (Sah)
                    </span>
                `;
            }
        } else if (dayMinutes >= TARGET_DAILY_MINUTES) {
            statusBadgeHtml = `
                <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                    <i class="fa-solid fa-circle-check mr-1 text-[9px]"></i> 100% (Terpenuhi)
                </span>
            `;
        } else if (dayMinutes > 0) {
            const shortMin = TARGET_DAILY_MINUTES - dayMinutes;
            const shortHour = (shortMin / 60).toFixed(1);
            statusBadgeHtml = `
                <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800">
                    Kurang ${shortHour}j (${percent}%)
                </span>
            `;
        } else {
            statusBadgeHtml = `
                <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                    0%
                </span>
            `;
        }

        // Row highlighting if selected
        const rowBg = isSelected
            ? 'bg-emerald-50/50 dark:bg-emerald-950/20'
            : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/40';

        return `
            <tr class="${rowBg} transition-colors">
                <!-- Kolom 1: Hari & Tanggal (1 Baris Ringkas) -->
                <td class="py-1.5 px-3 align-middle whitespace-nowrap">
                    <button type="button" onclick="window.selectEmployeeDay('${dStr}')" class="text-left group/day inline-flex items-center gap-1.5" title="Buka jadwal hari ${formattedDate}">
                        <span class="font-bold text-slate-800 dark:text-white text-xs group-hover/day:text-emerald-600 dark:group-hover/day:text-emerald-400 transition-colors">
                            ${compactDayDate}
                        </span>
                        ${isSelected ? '<span class="text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded bg-emerald-600 text-white shrink-0">Aktif</span>' : ''}
                    </button>
                </td>

                <!-- Kolom 2: Timeline Aktivitas (07:30 - 15:30) -->
                <td class="py-1.5 px-3 align-middle">
                    ${timelineHtml}
                </td>

                <!-- Kolom 3: Total Harian -->
                <td class="py-1.5 px-3 text-center align-middle whitespace-nowrap">
                    <div class="font-black text-xs text-slate-800 dark:text-slate-100 leading-tight">${dayHours} Jam</div>
                    <div class="text-[9px] text-slate-400 font-semibold leading-tight">${dayMinutes}m</div>
                </td>

                <!-- Kolom 4: Status Acuan -->
                <td class="py-1.5 px-3 text-center align-middle whitespace-nowrap">
                    ${statusBadgeHtml}
                </td>
            </tr>
        `;
    }).join('');

    tbody.innerHTML = rowsHtml;

    // Render Footer (Total Seminggu)
    if (tfoot) {
        const weekHours = (totalWeekMinutes / 60).toFixed(1);
        const weekPercent = TARGET_WEEKLY_MINUTES > 0 
            ? Math.min(100, Math.round((totalWeekMinutes / TARGET_WEEKLY_MINUTES) * 100)) 
            : 100;
        let weekBadge = '';

        if (totalWeekMinutes >= TARGET_WEEKLY_MINUTES) {
            weekBadge = `
                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                    <i class="fa-solid fa-trophy mr-1 text-[9px] text-amber-500"></i> Target Tercapai (${weekPercent}%)
                </span>
            `;
        } else {
            const shortWeekHours = ((TARGET_WEEKLY_MINUTES - totalWeekMinutes) / 60).toFixed(1);
            weekBadge = `
                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                    Kurang ${shortWeekHours} Jam (${weekPercent}%)
                </span>
            `;
        }

        tfoot.innerHTML = `
            <tr class="text-xs">
                <td class="py-2 px-3 text-slate-800 dark:text-white uppercase font-black tracking-wide align-middle">
                    Total 1 Pekan
                </td>
                <td class="py-2 px-3 text-slate-500 dark:text-slate-400 font-semibold text-[11px] align-middle">
                    Akumulasi ${workingDaysCount} Hari Kerja (Acuan Target: ${targetWeeklyHours} Jam / ${TARGET_WEEKLY_MINUTES} Menit${holidayDaysCount > 0 ? ` • ${holidayDaysCount} Hari Libur` : ''})
                </td>
                <td class="py-2 px-3 text-center whitespace-nowrap align-middle">
                    <div class="text-sm font-black text-emerald-600 dark:text-emerald-400 leading-tight">${weekHours} Jam</div>
                    <div class="text-[9px] text-slate-400 font-medium leading-tight">${totalWeekMinutes} Menit</div>
                </td>
                <td class="py-2 px-3 text-center whitespace-nowrap align-middle">
                    <div class="inline-flex items-center justify-center gap-2">
                        ${weekBadge}
                        <button type="button" onclick="window.setEmployeeToday()" class="px-2 py-0.5 rounded-lg text-[10px] font-extrabold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-all active:scale-95 shadow-xs" title="Lompat ke Hari Ini">
                            Hari Ini
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }
}

/**
 * Toggle Buka/Tutup Matriks Kinerja Mingguan Pegawai
 */
window.toggleEmployeeWeeklyMatrix = function() {
    const container = document.getElementById('container-employee-weekly-matrix');
    const textEl = document.getElementById('text-toggle-weekly-matrix');
    const iconEl = document.getElementById('icon-toggle-weekly-matrix');
    const btnEl = document.getElementById('btn-toggle-weekly-matrix');
    const indicatorEl = document.getElementById('indicator-toggle-weekly-matrix');
    if (!container) return;

    const isHidden = container.classList.contains('hidden');
    if (isHidden) {
        container.classList.remove('hidden');
        if (textEl) textEl.textContent = 'Sembunyikan';
        if (iconEl) iconEl.className = 'fa-solid fa-chevron-up text-[9px] transition-transform duration-200';
        if (btnEl) btnEl.classList.remove('btn-pulse-attention', 'animate-pulse');
        if (indicatorEl) indicatorEl.classList.add('hidden');
    } else {
        container.classList.add('hidden');
        if (textEl) textEl.textContent = 'Tampilkan';
        if (iconEl) iconEl.className = 'fa-solid fa-chevron-down text-[9px] transition-transform duration-200';
        if (btnEl) btnEl.classList.add('btn-pulse-attention', 'animate-pulse');
        if (indicatorEl) indicatorEl.classList.remove('hidden');
    }
};

/**
 * Tambah Aktivitas Khusus Tanggal Tertentu dari Matriks Mingguan
 */
window.addActivityForDate = function(dateStr, suggestedStart = null) {
    if (dateStr) {
        selectedDate = dateStr;
        const inputDate = document.getElementById('input-agenda-date');
        if (inputDate) inputDate.value = dateStr;
        const formDate = document.getElementById('form-activity-date');
        if (formDate) formDate.value = dateStr;
        updateHeaderContext();
    }
    window.openActivityModal();
    if (suggestedStart) {
        const startEl = document.getElementById('form-activity-start');
        const endEl = document.getElementById('form-activity-end');
        if (startEl) startEl.value = suggestedStart;
        if (endEl) {
            const [sh, sm] = suggestedStart.split(':').map(Number);
            const endTotal = sh * 60 + sm + 60;
            const endH = Math.floor(endTotal / 60) % 24;
            const endM = endTotal % 60;
            endEl.value = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
        }
        window.updateEffectivePreview();
        window.checkTimeOverlap();
    }
};

/**
 * Memilih Hari Aktif dari Strip Mingguan
 */
window.selectEmployeeDay = function(dateStr) {
    if (!dateStr) return;
    selectedDate = dateStr;
    const inputDate = document.getElementById('input-agenda-date');
    if (inputDate) inputDate.value = dateStr;
    loadEmployeeDayData();
};

// Keyboard listener: Escape untuk menutup modal rekap bulanan VIP
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const recapModal = document.getElementById('modal-employee-monthly-recap');
        if (recapModal && !recapModal.classList.contains('hidden')) {
            window.closeEmployeeMonthlyRecapModal();
        }
        const vipNoticeModal = document.getElementById('modal-employee-rekap-vip-notice');
        if (vipNoticeModal && !vipNoticeModal.classList.contains('hidden')) {
            window.closeEmployeeRekapVipNoticeModal();
        }
    }
});

// =========================================================================
// 11. PANEL REKAPITULASI SUPERVISI KEPALA SEKOLAH & PIMPINAN (MODE MONITORING)
// =========================================================================

let currentSummaryMode = 'weekly';
let selectedSummaryWeekDate = formatYMD(new Date());
let supervisorSummaryData = null;
let supervisorSummaryEmployees = [];
let supervisorSummaryUnassigned = [];
let supervisorSummaryWeekDays = [];
let isSummaryViewOpen = false;

/**
 * Memuat Data Ringkasan Supervisi dari D1 API (0 Firestore Read)
 */
async function loadSupervisorSummary() {
    const tableBody = document.getElementById('table-employee-summary-body');
    const counterEl = document.getElementById('summary-reported-counter');
    const unlinkedBanner = document.getElementById('unlinked-assignments-banner');
    const unlinkedText = document.getElementById('unlinked-assignments-banner-text');
    if (!tableBody) return;

    const colSpanLoading = currentSummaryMode === 'weekly' ? 9 : 7;
    tableBody.innerHTML = `<tr><td colspan="${colSpanLoading}" class="text-center py-6 text-slate-400 italic"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Memuat data monitoring pegawai...</td></tr>`;

    try {
        if (typeof window.loadVipStatusSummary === 'function') {
            window.loadVipStatusSummary().catch(e => console.warn('[VIP] Gagal memuat ringkasan VIP:', e));
        }
        let queryParams = { date: selectedDate };

        if (currentSummaryMode === 'weekly') {
            supervisorSummaryWeekDays = getWorkWeekDays(selectedSummaryWeekDate);
            const qFrom = supervisorSummaryWeekDays[0];
            const qTo = supervisorSummaryWeekDays[4];
            queryParams = { from: qFrom, to: qTo };
            if (typeof fetchAgendaHolidaysForRange === 'function') {
                await fetchAgendaHolidaysForRange(qFrom, qTo);
            }

            const navLabel = document.getElementById('weekly-nav-label');
            if (navLabel) {
                navLabel.textContent = `Pekan: ${qFrom} s.d. ${qTo}`;
            }
        } else {
            supervisorSummaryWeekDays = getWorkWeekDays(selectedDate);
            if (typeof fetchAgendaHolidaysForRange === 'function') {
                await fetchAgendaHolidaysForRange(selectedDate, selectedDate);
            }
        }

        const res = await cfClient.getEmployeeAgendaSummary(queryParams.from ? queryParams : selectedDate);
        const dataObj = res?.data || res || {};
        const list = Array.isArray(dataObj.employees) ? dataObj.employees : (Array.isArray(dataObj) ? dataObj : []);
        const unassignedList = Array.isArray(dataObj.unassigned_employees) ? dataObj.unassigned_employees : [];
        const unlinkedList = Array.isArray(dataObj.unlinked_assignments) ? dataObj.unlinked_assignments : [];

        supervisorSummaryData = dataObj;
        supervisorSummaryEmployees = list;
        supervisorSummaryUnassigned = unassignedList;

        // KPI Mingguan dengan target dinamis
        if (currentSummaryMode === 'weekly') {
            const kpiPercent = document.getElementById('weekly-kpi-percent');
            const kpiReported = document.getElementById('weekly-kpi-reported');
            const kpiTotalHours = document.getElementById('weekly-kpi-total-hours');

            let totalMinutesAll = 0;
            let fullyReportedCount = 0;
            const adjustedTarget = calculateAdjustedWeeklyTarget(supervisorSummaryWeekDays);
            const TARGET_WEEK_MIN = (typeof dataObj.target_minutes === 'number') 
                ? dataObj.target_minutes 
                : adjustedTarget.targetMinutes;
            const requiredWorkingDays = (typeof dataObj.working_days === 'number')
                ? dataObj.working_days
                : adjustedTarget.workingDays;

            list.forEach(p => {
                const eff = Number(p.total_effective_minutes || p.effective_minutes || 0);
                totalMinutesAll += eff;

                let reportedDays = 0;
                if (p.daily_breakdown) {
                    supervisorSummaryWeekDays.forEach(dStr => {
                        const dInfo = p.daily_breakdown[dStr];
                        if (dInfo && (dInfo.minutes > 0 || dInfo.activity_count > 0)) {
                            reportedDays++;
                        }
                    });
                } else if (p.reporting_days_count !== undefined) {
                    reportedDays = p.reporting_days_count;
                }
                if (reportedDays >= requiredWorkingDays && requiredWorkingDays > 0) {
                    fullyReportedCount++;
                }
            });

            const totalAssigned = list.length || 1;
            const avgMinutes = totalMinutesAll / totalAssigned;
            const avgPct = TARGET_WEEK_MIN > 0 ? Math.min(100, Math.round((avgMinutes / TARGET_WEEK_MIN) * 100)) : 100;
            const totalHours = (totalMinutesAll / 60).toFixed(1);

            if (kpiPercent) kpiPercent.textContent = `${avgPct}%`;
            if (kpiReported) {
                const labelDays = requiredWorkingDays > 0 ? `${requiredWorkingDays} Hari` : 'Pekan Penuh';
                kpiReported.textContent = `${fullyReportedCount} dari ${list.length} Pegawai (${labelDays})`;
            }
            if (kpiTotalHours) kpiTotalHours.textContent = `${totalHours} Jam`;
        }

        const dateObj = new Date(selectedDate);
        const dayOfWeek = dateObj.getDay();
        const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
        const dayName = INDO_DAYS[dayOfWeek] || '';
        const agendaHoliday = (typeof getAgendaHolidayForDate === 'function') ? getAgendaHolidayForDate(selectedDate) : null;
        const isHoliday = Boolean(dataObj.is_holiday || agendaHoliday);
        const holidayName = dataObj.holiday_name || agendaHoliday?.title || "Libur Resmi Agenda";
        const weekendBanner = document.getElementById('weekend-holiday-banner');
        const weekendText = document.getElementById('weekend-holiday-banner-text');

        // Banner Hari Libur Akhir Pekan / Libur Agenda (hanya jika mode harian)
        if (weekendBanner && weekendText) {
            if (currentSummaryMode !== 'weekly' && isWeekend) {
                weekendBanner.classList.remove('hidden');
                weekendText.innerHTML = `<strong>Hari ${escapeHTML(dayName)} (Libur Akhir Pekan):</strong> Hari ini merupakan hari libur kedinasan resmi sekolah (Sistem 5 Hari Kerja). Pegawai tidak diwajibkan mencatat kegiatan kecuali memiliki penugasan khusus atau dinas luar.`;
            } else if (currentSummaryMode !== 'weekly' && isHoliday) {
                weekendBanner.classList.remove('hidden');
                weekendText.innerHTML = `<strong>Hari Libur Agenda (${escapeHTML(holidayName)}):</strong> Hari ini merupakan hari libur resmi kalender agenda sekolah. Target jam kerja harian disesuaikan, pegawai tidak diwajibkan mencatat aktivitas kecuali memiliki tugas khusus.`;
            } else {
                weekendBanner.classList.add('hidden');
            }
        }

        // Banner Penugasan Belum Tertaut
        if (unlinkedBanner && unlinkedText) {
            if (unlinkedList.length > 0) {
                unlinkedBanner.classList.remove('hidden');
                unlinkedText.innerHTML = `<strong>Perhatian:</strong> Ditemukan <b>${unlinkedList.length} penugasan SK</b> yang belum tertaut ke akun/profil GTK terdaftar. Silakan lengkapi tautan pegawai pada menu <em>Kelola Penugasan</em>.`;
            } else {
                unlinkedBanner.classList.add('hidden');
            }
        }

        const reportedCount = typeof dataObj.total_reported === 'number' 
            ? dataObj.total_reported 
            : list.filter(p => (p.activity_count || 0) > 0 || (p.total_effective_minutes || 0) > 0).length;
        const totalCount = typeof dataObj.total_assigned === 'number' ? dataObj.total_assigned : list.length;

        if (counterEl) {
            if (currentSummaryMode === 'weekly') {
                const adjustedTarget = calculateAdjustedWeeklyTarget(supervisorSummaryWeekDays);
                const holidayNote = adjustedTarget.holidayDays > 0 ? ` (${adjustedTarget.holidayDays} Hari Libur - Target ${adjustedTarget.targetHours}j)` : '';
                counterEl.textContent = `${reportedCount} dari ${totalCount} Tendik Melaporkan Kinerja Pekan Ini${holidayNote}`;
            } else if (isWeekend && reportedCount === 0) {
                counterEl.textContent = `Hari ${dayName} (Libur Akhir Pekan) - 0 dari ${totalCount} Melapor`;
            } else if (isHoliday && reportedCount === 0) {
                counterEl.textContent = `Hari Libur Agenda (${escapeHTML(holidayName)}) - 0 dari ${totalCount} Melapor`;
            } else {
                counterEl.textContent = `${reportedCount} dari ${totalCount} Tendik Sudah Mencatat Aktivitas`;
            }
        }

        window.filterSupervisorEmployees();

    } catch (e) {
        console.error('[loadSupervisorSummary] Error:', e);
        tableBody.innerHTML = `<tr><td colspan="${colSpanLoading}" class="text-center py-6 text-rose-500 italic">Gagal memuat ringkasan monitoring pegawai: ${escapeHTML(e?.message || 'Error')}</td></tr>`;
    }
}

/**
 * Render Visual Ribbon Mini Timeline per Pegawai pada Matriks Harian
 */
function renderSupervisorDailyRibbon(item) {
    const DAY_START = 450; // 07:30
    const DAY_END = 930;   // 15:30
    const TOTAL_SPAN = DAY_END - DAY_START; // 480 menit
    const REST_START = 750; // 12:30
    const REST_END = 780;   // 13:00

    let acts = [];
    let dayAbsence = null;
    if (item.daily_breakdown && item.daily_breakdown[selectedDate]) {
        if (Array.isArray(item.daily_breakdown[selectedDate].activities)) {
            acts = item.daily_breakdown[selectedDate].activities;
        }
        dayAbsence = item.daily_breakdown[selectedDate].absence || null;
    } else if (item.daily_breakdown && Object.keys(item.daily_breakdown).length === 1) {
        const onlyDay = Object.values(item.daily_breakdown)[0];
        if (onlyDay && Array.isArray(onlyDay.activities)) acts = onlyDay.activities;
        if (onlyDay && onlyDay.absence) dayAbsence = onlyDay.absence;
    } else if (Array.isArray(item.activities)) {
        acts = item.activities;
    }

    const restLeft = ((REST_START - DAY_START) / TOTAL_SPAN) * 100;
    const restWidth = ((REST_END - REST_START) / TOTAL_SPAN) * 100;
    const empId = item.gtk_id || item.user_uid || item.person_id || item.id;

    if (acts.length === 0 && dayAbsence) {
        const iconName = dayAbsence.jenis === 'Sakit' ? 'fa-hospital-user' : (dayAbsence.jenis === 'Cuti' ? 'fa-plane-departure' : 'fa-clipboard-user');
        return `
            <div class="relative w-full h-6 bg-amber-50/90 dark:bg-amber-950/40 rounded-md overflow-hidden border border-amber-300/80 dark:border-amber-800/60 shadow-2xs cursor-pointer flex items-center justify-between px-2 text-amber-900 dark:text-amber-200 text-[10px] font-bold gap-1.5"
                 onclick="window.openSupervisorDetailModal('${escapeHTML(empId)}', '${selectedDate}')"
                 title="Keterangan Sah: ${escapeHTML(dayAbsence.jenis)} - ${escapeHTML(dayAbsence.alasan || '-')}">
                <div class="flex items-center gap-1.5 truncate">
                    <i class="fa-solid ${iconName} text-amber-600 dark:text-amber-400 text-[10px] shrink-0"></i>
                    <span class="truncate">Tidak Melaksanakan Tugas: <b>${escapeHTML(dayAbsence.jenis)}</b> (${escapeHTML(dayAbsence.alasan || 'Keterangan resmi')})</span>
                </div>
                <span class="px-1.5 py-0.2 rounded text-[8px] font-black uppercase bg-amber-200/80 dark:bg-amber-900/60 text-amber-900 dark:text-amber-100 shrink-0">Sah</span>
            </div>
        `;
    }

    let blocksHtml = '';
    if (acts.length > 0) {
        acts.forEach(act => {
            const [sh, sm] = (act.start_time || '07:30').split(':').map(Number);
            const [eh, em] = (act.end_time || '08:30').split(':').map(Number);
            const startMin = Math.max(DAY_START, Math.min(DAY_END, sh * 60 + sm));
            const endMin = Math.max(DAY_START, Math.min(DAY_END, eh * 60 + em));
            const durationMin = Math.max(0, endMin - startMin);
            if (durationMin <= 0) return;

            const leftPct = ((startMin - DAY_START) / TOTAL_SPAN) * 100;
            const widthPct = (durationMin / TOTAL_SPAN) * 100;

            const tooltipAlignClass = leftPct < 25 ? 'left-0' : (leftPct > 75 ? 'right-0' : 'left-1/2 -translate-x-1/2');
            const arrowAlignClass = leftPct < 25 ? 'left-4' : (leftPct > 75 ? 'right-4' : 'left-1/2 -translate-x-1/2');

            const titleText = escapeHTML(act.task_item_name || act.task_name || act.description || 'Aktivitas Pegawai');
            const locText = act.location ? `<div class="text-[10px] text-slate-300 mt-1 flex items-center gap-1"><i class="fa-solid fa-location-dot text-emerald-400"></i> ${escapeHTML(act.location)}</div>` : '';
            const outText = act.output ? `<div class="text-[10px] text-slate-300 mt-0.5 flex items-center gap-1"><i class="fa-solid fa-box-archive text-blue-400"></i> ${escapeHTML(act.output)}</div>` : '';
            const dutyText = act.is_outside_duty ? `<div class="text-[10px] font-bold text-amber-300 mt-0.5"><i class="fa-solid fa-car-side"></i> Dinas Luar</div>` : '';

            blocksHtml += `
                <div class="absolute h-full bg-emerald-500 hover:bg-emerald-400 group border-r border-white/25 z-20 hover:z-40 transition-all hover:brightness-110 flex items-center justify-center overflow-visible"
                     style="left: ${leftPct}%; width: ${widthPct}%;"
                     onclick="event.stopPropagation(); window.openSupervisorDetailModal('${escapeHTML(empId)}', '${selectedDate}')">
                    ${widthPct >= 8 ? `<span class="text-[9px] font-black text-slate-950 px-0.5 select-none pointer-events-none">${act.start_time}</span>` : ''}
                    <div class="absolute bottom-full mb-2 ${tooltipAlignClass} hidden group-hover:flex flex-col w-56 sm:w-64 p-2.5 bg-slate-900/95 text-white rounded-xl shadow-2xl border border-slate-700/80 backdrop-blur-md pointer-events-none transition-all duration-150 z-50 text-left">
                        <div class="flex items-center justify-between gap-1 pb-1 border-b border-slate-800">
                            <span class="font-mono text-xs font-black text-emerald-400"><i class="fa-regular fa-clock text-[10px] mr-1"></i>${act.start_time} – ${act.end_time}</span>
                            <span class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">${durationMin}m</span>
                        </div>
                        <div class="mt-1 font-bold text-xs text-white leading-snug line-clamp-2">${titleText}</div>
                        ${locText}
                        ${outText}
                        ${dutyText}
                        <div class="absolute top-full ${arrowAlignClass} border-4 border-transparent border-t-slate-900"></div>
                    </div>
                </div>
            `;
        });
    }

    return `
        <div class="relative w-full h-6 bg-slate-100 dark:bg-slate-800/90 rounded-md overflow-hidden border border-slate-200/80 dark:border-slate-700/80 shadow-2xs cursor-pointer group/ribbon"
             onclick="window.openSupervisorDetailModal('${escapeHTML(empId)}', '${selectedDate}')"
             title="Klik untuk melihat rincian aktivitas">
            <div class="absolute h-full bg-amber-400/85 hover:bg-amber-400 z-10 flex items-center justify-center cursor-default pointer-events-none" style="left: ${restLeft}%; width: ${restWidth}%;" title="Istirahat Siang (12:30 - 13:00)">
                <span class="text-[7px] font-black text-amber-950 uppercase tracking-tighter select-none hidden sm:inline">IST</span>
            </div>
            ${blocksHtml}
            ${acts.length === 0 ? '<div class="absolute inset-0 flex items-center justify-center text-[10px] text-slate-400 italic pointer-events-none">Belum ada catatan aktivitas</div>' : ''}
        </div>
    `;
}

/**
 * Render Baris Matriks Supervisi Harian
 */
function renderSupervisorDailyMatrix(assignedList, unassignedList, headEl, bodyEl, footEl) {
    headEl.innerHTML = `
        <tr class="border-b border-slate-200 dark:border-slate-800 text-slate-400 font-bold uppercase text-[9px] tracking-wider">
            <th class="py-1.5 px-2.5 min-w-[170px] sm:min-w-[200px]">Pegawai Tendik</th>
            <th class="py-1.5 px-2 text-center min-w-[240px] sm:min-w-[300px]">Visual Timeline Pita Jam Kerja (07:30 – 15:30)</th>
            <th class="py-1.5 px-2 text-center w-24">Rentang Jam</th>
            <th class="py-1.5 px-2 text-center w-28">Total Jam Harian</th>
            <th class="py-1.5 px-2 text-center min-w-[110px]">Status Acuan</th>
            <th class="py-1.5 px-2 text-center w-20">Dinas Luar</th>
            <th class="py-1.5 px-2.5 text-right w-20">Aksi</th>
        </tr>
    `;

    if (assignedList.length === 0 && unassignedList.length === 0) {
        bodyEl.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-slate-400 italic">Tidak ada pegawai yang sesuai dengan filter pencarian.</td></tr>';
        if (footEl) footEl.innerHTML = '';
        return;
    }

    let totalDailyMin = 0;
    let reportedDailyCount = 0;
    let totalDailyDl = 0;

    const renderDailyRow = (item, isUnassigned = false) => {
        const empId = item.gtk_id || item.user_uid || item.person_id || item.id;
        const empName = item.employee_name || item.name || empId;
        const empNip = item.employee_nip ? `NIP. ${item.employee_nip}` : '';
        const actCount = item.activity_count || 0;
        const effMin = (item.total_effective_minutes !== undefined) ? item.total_effective_minutes : (item.effective_minutes || 0);
        const dayAbsence = item.daily_breakdown?.[selectedDate]?.absence || (item.daily_breakdown && Object.keys(item.daily_breakdown).length === 1 ? Object.values(item.daily_breakdown)[0]?.absence : null);
        const hasReported = Boolean(item.has_reported || actCount > 0 || effMin > 0 || dayAbsence);
        const hours = (effMin / 60).toFixed(1);
        const dlCount = item.outside_duty_count || 0;

        totalDailyMin += effMin;
        if (hasReported) reportedDailyCount++;
        totalDailyDl += dlCount;

        const timeSpan = (item.earliest_start && item.latest_end)
            ? `${item.earliest_start} – ${item.latest_end}`
            : '-';

        let durationDisplay = '-';
        if (effMin > 0) {
            durationDisplay = `<div class="font-extrabold text-slate-800 dark:text-slate-100 text-xs">${hours} Jam</div><div class="text-[9px] text-slate-400 font-normal">${effMin} Menit</div>`;
        } else if (dayAbsence) {
            durationDisplay = '<span class="text-amber-700 dark:text-amber-300 text-xs font-semibold">0 Menit</span>';
        } else if (hasReported) {
            durationDisplay = '<span class="text-slate-400 text-xs font-semibold">0 Menit</span>';
        } else {
            durationDisplay = '<span class="text-slate-400 text-xs">-</span>';
        }

        const isWeekend = Boolean(supervisorSummaryData?.is_weekend || (supervisorSummaryData?.period && supervisorSummaryData?.period.is_weekend));
        let statusBadge = '';
        if (isWeekend && currentSummaryMode !== 'weekly') {
            statusBadge = '<span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-300 border border-blue-200 dark:border-blue-900/60">Libur akhir pekan</span>';
        } else if (dayAbsence && effMin === 0) {
            statusBadge = `<span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-800 flex items-center justify-center gap-1" title="${escapeHTML(dayAbsence.jenis)}: ${escapeHTML(dayAbsence.alasan || '-')}"><i class="fa-solid fa-hospital-user text-[8px]"></i> ${escapeHTML(dayAbsence.jenis)} (Sah)</span>`;
        } else if (!hasReported) {
            statusBadge = '<span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700/60">Belum Lapor</span>';
        } else if (effMin >= 450) {
            statusBadge = '<span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center gap-1"><i class="fa-solid fa-check text-[9px]"></i> Target Terpenuhi</span>';
        } else if (effMin > 0) {
            const diffMin = 450 - effMin;
            statusBadge = `<span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 flex items-center justify-center">Kurang ${diffMin}m</span>`;
        } else {
            statusBadge = `<span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300">Sudah mencatat (${actCount})</span>`;
        }

        const assignmentBadge = (item.assignment_count && item.assignment_count > 1)
            ? `<span class="ml-1.5 px-1.5 py-0.5 rounded text-[9px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-normal border border-slate-200 dark:border-slate-700">${item.assignment_count} Tugas SK</span>`
            : '';

        const dlDisplay = dlCount > 0
            ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">${dlCount} DL</span>`
            : '<span class="text-slate-400 text-xs">-</span>';

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                <td class="py-1.5 px-2.5">
                    ${(() => {
                        const isVip = typeof window.isPtkVip === 'function' ? window.isPtkVip(empId) : false;
                        const vipBadge = isVip ? '<i class="fa-solid fa-crown text-[10px] text-amber-500 shrink-0" title="Pengguna VIP SIMAS"></i>' : '';
                        return `
                            <div class="font-bold text-slate-800 dark:text-white flex items-center gap-1.5 flex-wrap text-xs">
                                <span>${escapeHTML(empName)}</span>
                                ${vipBadge}
                                ${assignmentBadge}
                                ${isUnassigned ? '<span class="ml-1 px-1.5 py-0.2 rounded text-[8px] bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 font-medium">Di luar SK aktif</span>' : ''}
                            </div>
                        `;
                    })()}
                    ${empNip ? `<div class="text-[9px] text-slate-400 mt-0.5 font-mono">${escapeHTML(empNip)}</div>` : ''}
                </td>
                <td class="py-1.5 px-2 align-middle">
                    ${renderSupervisorDailyRibbon(item)}
                </td>
                <td class="py-1.5 px-2 text-center text-slate-600 dark:text-slate-300 font-mono text-[11px] whitespace-nowrap align-middle">
                    ${timeSpan}
                </td>
                <td class="py-1.5 px-2 text-center whitespace-nowrap align-middle">
                    ${durationDisplay}
                </td>
                <td class="py-1.5 px-2 text-center whitespace-nowrap align-middle">
                    ${statusBadge}
                </td>
                <td class="py-1.5 px-2 text-center whitespace-nowrap align-middle">
                    ${dlDisplay}
                </td>
                <td class="py-1.5 px-2.5 text-right whitespace-nowrap align-middle">
                    <button type="button" onclick="window.openSupervisorDetailModal('${escapeHTML(empId)}', '${selectedDate}')" class="px-2 py-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:hover:bg-emerald-900 dark:text-emerald-300 rounded-md text-[11px] font-bold transition-all shadow-2xs cursor-pointer">
                        Rincian
                    </button>
                </td>
            </tr>
        `;
    };

    let html = assignedList.map(item => renderDailyRow(item, false)).join('');

    if (unassignedList.length > 0) {
        html += `
            <tr class="bg-amber-50/70 dark:bg-amber-950/30 border-t border-amber-200/60 dark:border-amber-900/40">
                <td colspan="7" class="py-2 px-3 text-[11px] font-bold text-amber-800 dark:text-amber-300">
                    <i class="fa-solid fa-user-clock mr-1.5"></i> Pegawai yang Melapor di Luar Penugasan SK Aktif (${unassignedList.length})
                </td>
            </tr>
        `;
        html += unassignedList.map(item => renderDailyRow(item, true)).join('');
    }

    bodyEl.innerHTML = html;

    if (footEl) {
        const totalPopulation = assignedList.length + unassignedList.length;
        const totalHoursFormatted = (totalDailyMin / 60).toFixed(1);

        footEl.innerHTML = `
            <tr class="font-bold">
                <td class="py-2 px-2.5">
                    Total Kinerja (${reportedDailyCount} dari ${totalPopulation} Melapor)
                </td>
                <td class="py-2 px-2 text-center text-xs font-medium text-slate-400">
                    -
                </td>
                <td class="py-2 px-2 text-center text-slate-400 text-xs">-</td>
                <td class="py-2 px-2 text-center">
                    <div class="font-black text-emerald-700 dark:text-emerald-300 text-xs">${totalHoursFormatted} Jam</div>
                    <div class="text-[9px] text-slate-400 font-normal">${totalDailyMin} Menit</div>
                </td>
                <td class="py-2 px-2 text-center text-xs text-slate-500">
                    Rata-rata: ${totalPopulation > 0 ? (totalDailyMin / totalPopulation / 60).toFixed(1) : 0}j
                </td>
                <td class="py-2 px-2 text-center text-xs">
                    ${totalDailyDl > 0 ? `<span class="text-amber-600 font-bold">${totalDailyDl} DL</span>` : '-'}
                </td>
                <td class="py-2 px-2.5 text-right text-slate-400 text-xs">-</td>
            </tr>
        `;
    }
}

/**
 * Render Baris Matriks Supervisi Mingguan
 */
function renderSupervisorWeeklyMatrix(assignedList, unassignedList, headEl, bodyEl, footEl) {
    const days = supervisorSummaryWeekDays.length === 5 ? supervisorSummaryWeekDays : getWorkWeekDays(selectedSummaryWeekDate);
    const adjustedTarget = calculateAdjustedWeeklyTarget(days);
    const TARGET_WEEK_MIN = (supervisorSummaryData && typeof supervisorSummaryData.target_minutes === 'number') 
        ? supervisorSummaryData.target_minutes 
        : adjustedTarget.targetMinutes;
    const targetHoursStr = (TARGET_WEEK_MIN / 60).toFixed(1).replace('.0', '').replace('.', ',');

    const dayHeaders = days.map((dStr, idx) => {
        const dName = INDO_DAYS[idx + 1] || 'Hari';
        const parts = dStr.split('-');
        const shortDate = `${parts[2]}/${parts[1]}`;
        const dayHoliday = (typeof getAgendaHolidayForDate === 'function') ? getAgendaHolidayForDate(dStr) : null;
        const holidayBadge = dayHoliday ? '<span class="block text-[8px] font-bold text-rose-500 tracking-tight leading-none mt-0.5">Libur</span>' : '';
        const thBg = dayHoliday ? 'bg-rose-50/50 dark:bg-rose-950/20' : '';

        return `
            <th class="py-1.5 px-1 text-center min-w-[70px] ${thBg}">
                <div>${dName}</div>
                <div class="text-[8px] font-normal text-slate-400 font-mono">${shortDate}</div>
                ${holidayBadge}
            </th>
        `;
    }).join('');

    headEl.innerHTML = `
        <tr class="border-b border-slate-200 dark:border-slate-800 text-slate-400 font-bold uppercase text-[9px] tracking-wider">
            <th class="py-1.5 px-2.5 min-w-[170px] sm:min-w-[200px]">Pegawai Tendik</th>
            ${dayHeaders}
            <th class="py-1.5 px-2 text-center min-w-[90px]">Total Pekan</th>
            <th class="py-1.5 px-2 text-center min-w-[120px]" title="Status Target (37,5j)">Status Target (${targetHoursStr}j)</th>
            <th class="py-1.5 px-2 text-right w-20">Aksi</th>
        </tr>
    `;

    if (assignedList.length === 0 && unassignedList.length === 0) {
        bodyEl.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-slate-400 italic">Tidak ada pegawai yang sesuai dengan filter pencarian.</td></tr>';
        if (footEl) footEl.innerHTML = '';
        return;
    }

    let totalWeekMinutesAll = 0;
    const dayTotals = { [days[0]]: 0, [days[1]]: 0, [days[2]]: 0, [days[3]]: 0, [days[4]]: 0 };

    const renderWeeklyRow = (item, isUnassigned = false) => {
        const empId = item.gtk_id || item.user_uid || item.person_id || item.id;
        const empName = item.employee_name || item.name || empId;
        const empNip = item.employee_nip ? `NIP. ${item.employee_nip}` : '';
        const effMin = (item.total_effective_minutes !== undefined) ? item.total_effective_minutes : (item.effective_minutes || 0);
        const hours = (effMin / 60).toFixed(1);
        const pct = TARGET_WEEK_MIN > 0 ? Math.min(100, Math.round((effMin / TARGET_WEEK_MIN) * 100)) : 100;

        totalWeekMinutesAll += effMin;

        const dayCells = days.map(dStr => {
            const dData = item.daily_breakdown?.[dStr];
            const dayHoliday = (typeof getAgendaHolidayForDate === 'function') ? getAgendaHolidayForDate(dStr) : null;
            const dayAbsence = dData?.absence || null;
            if (dData && dData.minutes > 0) {
                dayTotals[dStr] = (dayTotals[dStr] || 0) + dData.minutes;
                const dHrs = (dData.minutes / 60).toFixed(1);
                const dlBadge = dData.outside_duty_count > 0 ? '<span class="inline-block px-1 py-0.2 rounded text-[8px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 ml-1">DL</span>' : '';
                return `
                    <td class="py-1 px-1 text-center align-middle">
                        <div onclick="window.openSupervisorDetailModal('${escapeHTML(empId)}', '${dStr}')"
                             role="button"
                             tabindex="0"
                             class="cursor-pointer hover:bg-emerald-50 dark:hover:bg-emerald-950/40 py-1 px-1.5 rounded-lg border border-transparent hover:border-emerald-200 dark:hover:border-emerald-800 transition-all text-center group"
                             title="Klik untuk melihat rincian aktivitas ${dStr}">
                            <div class="font-extrabold text-emerald-700 dark:text-emerald-300 text-xs leading-snug">${dHrs}j ${dlBadge}</div>
                            <div class="text-[8px] text-slate-400 dark:text-slate-500 leading-none mt-0.5">${dData.minutes}m · ${dData.activity_count} keg</div>
                        </div>
                    </td>
                `;
            }
            if (dayAbsence) {
                const absType = dayAbsence.jenis || dayAbsence.absence_type || 'Izin';
                const absReason = dayAbsence.alasan || dayAbsence.reason || '';
                return `
                    <td class="py-1 px-1 text-center align-middle bg-amber-50/30 dark:bg-amber-950/15">
                        <div onclick="window.openSupervisorDetailModal('${escapeHTML(empId)}', '${dStr}')"
                             role="button"
                             tabindex="0"
                             class="cursor-pointer hover:bg-amber-100/60 dark:hover:bg-amber-900/40 py-1 px-1 rounded-lg border border-amber-200/80 dark:border-amber-800/60 transition-all text-center"
                             title="${escapeHTML(absType)}${absReason ? ': ' + escapeHTML(absReason) : ''}">
                            <div class="font-extrabold text-amber-700 dark:text-amber-300 text-[10px] leading-snug">${escapeHTML(absType)}</div>
                            <div class="text-[8px] text-amber-600/80 dark:text-amber-400/80 font-bold leading-none mt-0.5">Sah</div>
                        </div>
                    </td>
                `;
            }
            if (dayHoliday) {
                return `
                    <td class="py-1 px-1 text-center align-middle bg-rose-50/20 dark:bg-rose-950/10">
                        <div onclick="window.openSupervisorDetailModal('${escapeHTML(empId)}', '${dStr}')"
                             role="button"
                             tabindex="0"
                             class="cursor-pointer py-1 px-1 rounded-lg transition-all text-center"
                             title="Hari Libur Agenda: ${escapeHTML(dayHoliday.title)}. Klik untuk melihat tanggal ${dStr}">
                            <span class="inline-block px-1.5 py-0.5 rounded text-[8px] font-bold bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border border-rose-200/80 dark:border-rose-900/60">Libur</span>
                        </div>
                    </td>
                `;
            }
            return `
                <td class="py-1 px-1 text-center align-middle">
                    <div onclick="window.openSupervisorDetailModal('${escapeHTML(empId)}', '${dStr}')"
                         role="button"
                         tabindex="0"
                         class="cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/60 py-1 px-1 rounded-lg border border-transparent hover:border-slate-200 dark:hover:border-slate-700 transition-all text-center"
                         title="Klik untuk melihat tanggal ${dStr}">
                        <div class="py-0.5 text-slate-300 dark:text-slate-600 font-medium text-xs leading-none">-</div>
                    </div>
                </td>
            `;
        }).join('');

        let statusTargetBadge = '';
        if (effMin >= TARGET_WEEK_MIN) {
            statusTargetBadge = '<span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center gap-1"><i class="fa-solid fa-check text-[9px]"></i> Target Terpenuhi</span>';
        } else {
            const diffMin = TARGET_WEEK_MIN - effMin;
            const diffHrs = (diffMin / 60).toFixed(1);
            statusTargetBadge = `<span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 flex items-center justify-center">Kurang ${diffHrs} Jam</span>`;
        }

        const assignmentBadge = (item.assignment_count && item.assignment_count > 1)
            ? `<span class="ml-1.5 px-1.5 py-0.5 rounded text-[9px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-normal border border-slate-200 dark:border-slate-700">${item.assignment_count} Tugas SK</span>`
            : '';

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                <td class="py-1.5 px-2.5">
                    ${(() => {
                        const isVip = typeof window.isPtkVip === 'function' ? window.isPtkVip(empId) : false;
                        const vipBadge = isVip ? '<i class="fa-solid fa-crown text-[10px] text-amber-500 shrink-0" title="Pengguna VIP SIMAS"></i>' : '';
                        return `
                            <div class="font-bold text-slate-800 dark:text-white flex items-center gap-1.5 flex-wrap text-xs">
                                <span>${escapeHTML(empName)}</span>
                                ${vipBadge}
                                ${assignmentBadge}
                                ${isUnassigned ? '<span class="ml-1 px-1.5 py-0.2 rounded text-[8px] bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 font-medium">Di luar SK aktif</span>' : ''}
                            </div>
                        `;
                    })()}
                    ${empNip ? `<div class="text-[9px] text-slate-400 mt-0.5 font-mono">${escapeHTML(empNip)}</div>` : ''}
                </td>
                ${dayCells}
                <td class="py-1.5 px-2 text-center align-middle">
                    <div onclick="window.openSupervisorDetailModal('${escapeHTML(empId)}', 'week')"
                         role="button"
                         tabindex="0"
                         class="cursor-pointer hover:bg-indigo-50/60 dark:hover:bg-indigo-950/40 p-1 rounded-lg transition-all"
                         title="Klik untuk melihat rincian pekan">
                        <div class="font-extrabold text-slate-800 dark:text-slate-100 text-xs leading-snug">${hours} Jam</div>
                        <div class="text-[9px] text-slate-400 leading-none mt-0.5">${effMin}m · ${pct}%</div>
                    </div>
                </td>
                <td class="py-1.5 px-2 text-center whitespace-nowrap align-middle">
                    ${statusTargetBadge}
                </td>
                <td class="py-1.5 px-2 text-right whitespace-nowrap align-middle">
                    <button type="button" onclick="window.openSupervisorDetailModal('${escapeHTML(empId)}', 'week')" class="px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:hover:bg-indigo-900 dark:text-indigo-300 rounded-md text-[11px] font-bold transition-all shadow-2xs cursor-pointer">
                        Rincian
                    </button>
                </td>
            </tr>
        `;
    };

    let html = assignedList.map(item => renderWeeklyRow(item, false)).join('');

    if (unassignedList.length > 0) {
        html += `
            <tr class="bg-amber-50/70 dark:bg-amber-950/30 border-t border-amber-200/60 dark:border-amber-900/40">
                <td colspan="9" class="py-2 px-3 text-[11px] font-bold text-amber-800 dark:text-amber-300">
                    <i class="fa-solid fa-user-clock mr-1.5"></i> Pegawai yang Melapor di Luar Penugasan SK Aktif (${unassignedList.length})
                </td>
            </tr>
        `;
        html += unassignedList.map(item => renderWeeklyRow(item, true)).join('');
    }

    bodyEl.innerHTML = html;

    if (footEl) {
        const totalPopulation = assignedList.length + unassignedList.length;
        const totalHoursFormatted = (totalWeekMinutesAll / 60).toFixed(1);
        const dayTotalCells = days.map(dStr => {
            const totMin = dayTotals[dStr] || 0;
            const dHrs = (totMin / 60).toFixed(1);
            return `
                <td class="py-1.5 px-1 text-center align-middle">
                    <div class="font-bold text-xs text-slate-700 dark:text-slate-300">${dHrs}j</div>
                    <div class="text-[8px] text-slate-400 font-normal mt-0.5">${totMin}m</div>
                </td>
            `;
        }).join('');

        footEl.innerHTML = `
            <tr class="font-bold border-t border-slate-200 dark:border-slate-800">
                <td class="py-1.5 px-2.5 font-bold text-slate-700 dark:text-slate-300">
                    Total Himpunan Kinerja
                </td>
                ${dayTotalCells}
                <td class="py-1.5 px-2 text-center">
                    <div class="font-black text-emerald-700 dark:text-emerald-300 text-xs leading-snug">${totalHoursFormatted} Jam</div>
                    <div class="text-[8px] text-slate-400 font-normal leading-none mt-0.5">${totalWeekMinutesAll} Menit</div>
                </td>
                <td class="py-1.5 px-2 text-center text-slate-700 dark:text-slate-300 text-xs">
                    ${totalPopulation} Tendik
                </td>
                <td class="py-1.5 px-2 text-right">-</td>
            </tr>
        `;
    }
}

/**
 * Switch Mode Rekapitulasi Supervisi: Harian vs Mingguan
 */
window.setSummaryMode = async function(mode) {
    currentSummaryMode = mode;

    const btnDaily = document.getElementById('btn-summary-mode-daily');
    const btnWeekly = document.getElementById('btn-summary-mode-weekly');
    const weeklyNav = document.getElementById('weekly-nav-bar');
    const weeklyKpi = document.getElementById('weekly-kpi-container');

    if (currentSummaryMode === 'weekly') {
        btnWeekly?.classList.remove('text-slate-500', 'dark:text-slate-400');
        btnWeekly?.classList.add('bg-white', 'dark:bg-slate-700', 'text-emerald-700', 'dark:text-emerald-300', 'shadow-xs');
        btnDaily?.classList.remove('bg-white', 'dark:bg-slate-700', 'text-emerald-700', 'dark:text-emerald-300', 'shadow-xs');
        btnDaily?.classList.add('text-slate-500', 'dark:text-slate-400');

        weeklyNav?.classList.remove('hidden');
        weeklyKpi?.classList.remove('hidden');
    } else {
        btnDaily?.classList.remove('text-slate-500', 'dark:text-slate-400');
        btnDaily?.classList.add('bg-white', 'dark:bg-slate-700', 'text-emerald-700', 'dark:text-emerald-300', 'shadow-xs');
        btnWeekly?.classList.remove('bg-white', 'dark:bg-slate-700', 'text-emerald-700', 'dark:text-emerald-300', 'shadow-xs');
        btnWeekly?.classList.add('text-slate-500', 'dark:text-slate-400');

        weeklyNav?.classList.add('hidden');
        weeklyKpi?.classList.add('hidden');
    }

    await loadSupervisorSummary();
};

/**
 * Navigasi Pekan Supervisi (+1 atau -1 Pekan)
 */
window.navigateSummaryWeek = async function(direction) {
    const parts = selectedSummaryWeekDate.split('-');
    const cur = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    cur.setDate(cur.getDate() + (direction * 7));
    selectedSummaryWeekDate = formatYMD(cur);
    await loadSupervisorSummary();
};

/**
 * Buka / Tutup Detail Perincian Harian Pegawai pada Tabel Mingguan (Backward Compatibility)
 */
window.toggleWeeklyPersonDetail = function(personId) {
    const detailRow = document.getElementById(`weekly-detail-row-${personId}`);
    if (detailRow) {
        detailRow.classList.toggle('hidden');
    } else {
        window.openSupervisorDetailModal(personId, 'week');
    }
};

/**
 * Toggle Panel Rekapitulasi Supervisi Kepala Sekolah
 */
window.toggleEmployeeSummary = async function(forceState) {
    if (!isSupervisor) return;

    const panel = document.getElementById('section-employee-summary-view');
    if (!panel) return;

    if (typeof forceState === 'boolean') {
        isSummaryViewOpen = forceState;
    } else {
        isSummaryViewOpen = !isSummaryViewOpen;
    }

    if (isSummaryViewOpen) {
        panel.classList.remove('hidden');
        await loadSupervisorSummary();
    } else {
        panel.classList.add('hidden');
    }
};

/**
 * Filter Pencarian Cepat dan Status Pelaporan Pegawai pada Matriks Supervisi
 */
window.filterSupervisorEmployees = function() {
    const searchInput = document.getElementById('search-supervisor-employee');
    const statusSelect = document.getElementById('filter-supervisor-status');
    const query = (searchInput?.value || '').toLowerCase().trim();
    const statusFilter = statusSelect?.value || 'all';

    const matchesFilter = (item) => {
        if (query) {
            const name = (item.employee_name || item.name || '').toLowerCase();
            const nip = (item.employee_nip || '').toLowerCase();
            if (!name.includes(query) && !nip.includes(query)) {
                return false;
            }
        }

        const eff = Number(item.total_effective_minutes || item.effective_minutes || 0);
        const actCount = Number(item.activity_count || 0);
        const hasReported = (eff > 0 || actCount > 0);

        if (statusFilter === 'reported' && !hasReported) return false;
        if (statusFilter === 'unreported' && hasReported) return false;

        return true;
    };

    const assignedFiltered = supervisorSummaryEmployees.filter(matchesFilter);
    const unassignedFiltered = supervisorSummaryUnassigned.filter(matchesFilter);

    const headEl = document.getElementById('table-employee-summary-head');
    const bodyEl = document.getElementById('table-employee-summary-body');
    const footEl = document.getElementById('table-employee-summary-foot');
    if (!headEl || !bodyEl) return;

    if (currentSummaryMode === 'weekly') {
        renderSupervisorWeeklyMatrix(assignedFiltered, unassignedFiltered, headEl, bodyEl, footEl);
    } else {
        renderSupervisorDailyMatrix(assignedFiltered, unassignedFiltered, headEl, bodyEl, footEl);
    }
};

let _closeSupervisorModalTimer = null;

/**
 * Membuka Modal Pop-Up Rincian Kegiatan Pegawai (POV Supervisor)
 */
window.openSupervisorDetailModal = function(empId, targetDateOrWeek) {
    if (_closeSupervisorModalTimer) {
        clearTimeout(_closeSupervisorModalTimer);
        _closeSupervisorModalTimer = null;
    }

    const modal = document.getElementById('modal-supervisor-employee-detail');
    const content = document.getElementById('modal-supervisor-employee-detail-content');
    const nameEl = document.getElementById('modal-supervisor-detail-name');
    const subtitleEl = document.getElementById('modal-supervisor-detail-subtitle');
    const statsEl = document.getElementById('modal-supervisor-detail-stats');
    const activitiesEl = document.getElementById('modal-supervisor-detail-activities');
    const btnInspect = document.getElementById('modal-supervisor-detail-btn-inspect');

    if (!modal) return;
    if (_supervisorDetailActivitiesMap) _supervisorDetailActivitiesMap.clear();

    const allEmps = [...supervisorSummaryEmployees, ...supervisorSummaryUnassigned];
    const targetIdStr = String(empId || '').trim();
    const person = allEmps.find(p => {
        if (!p) return false;
        if (String(p.gtk_id || '').trim() === targetIdStr) return true;
        if (String(p.user_uid || '').trim() === targetIdStr) return true;
        if (String(p.person_id || '').trim() === targetIdStr) return true;
        if (String(p.id || '').trim() === targetIdStr) return true;
        if (Array.isArray(p.user_uids) && p.user_uids.map(u => String(u).trim()).includes(targetIdStr)) return true;
        return false;
    }) || {
        employee_name: empId,
        gtk_id: empId
    };

    const isWeek = (targetDateOrWeek === 'week');
    const targetDate = isWeek ? selectedSummaryWeekDate : (targetDateOrWeek || selectedDate);

    if (nameEl) nameEl.textContent = person.employee_name || person.name || 'Rincian Pegawai';
    if (subtitleEl) {
        const nipStr = person.employee_nip ? `NIP. ${person.employee_nip}` : 'Tenaga Kependidikan';
        subtitleEl.textContent = isWeek ? `${nipStr} · Pekan Kinerja (${targetDate})` : `${nipStr} · ${targetDate}`;
    }

    if (statsEl) {
        if (isWeek) {
            const effMin = Number(person.total_effective_minutes || person.effective_minutes || 0);
            const effHours = (effMin / 60).toFixed(1);
            const actCount = person.activity_count || 0;
            const targetMin = (supervisorSummaryData?.target_minutes) || 2250;
            const pct = Math.min(100, Math.round((effMin / targetMin) * 100));

            statsEl.innerHTML = `
                <div class="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/60">
                    <span class="text-[10px] text-slate-400 font-bold uppercase block">Total Jam Pekan</span>
                    <span class="text-sm font-black text-emerald-700 dark:text-emerald-300">${effHours} Jam</span>
                </div>
                <div class="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/60">
                    <span class="text-[10px] text-slate-400 font-bold uppercase block">Persentase Target</span>
                    <span class="text-sm font-black text-emerald-700 dark:text-emerald-300">${pct}%</span>
                </div>
                <div class="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/60">
                    <span class="text-[10px] text-slate-400 font-bold uppercase block">Total Menit Efektif</span>
                    <span class="text-sm font-black text-slate-800 dark:text-slate-100">${effMin}m</span>
                </div>
                <div class="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/60">
                    <span class="text-[10px] text-slate-400 font-bold uppercase block">Total Kegiatan</span>
                    <span class="text-sm font-black text-slate-800 dark:text-slate-100">${actCount}</span>
                </div>
            `;
        } else {
            const dayData = person.daily_breakdown?.[targetDate];
            const dayMin = Number(dayData?.minutes || 0);
            const dayHours = (dayMin / 60).toFixed(1);
            const actCount = Number(dayData?.activity_count || (Array.isArray(dayData?.activities) ? dayData.activities.length : 0));
            const dlCount = Number(dayData?.outside_duty_count || 0);

            statsEl.innerHTML = `
                <div class="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/60">
                    <span class="text-[10px] text-slate-400 font-bold uppercase block">Total Jam Harian</span>
                    <span class="text-sm font-black text-emerald-700 dark:text-emerald-300">${dayHours} Jam</span>
                </div>
                <div class="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/60">
                    <span class="text-[10px] text-slate-400 font-bold uppercase block">Menit Efektif</span>
                    <span class="text-sm font-black text-slate-800 dark:text-slate-100">${dayMin} Menit</span>
                </div>
                <div class="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/60">
                    <span class="text-[10px] text-slate-400 font-bold uppercase block">Jumlah Kegiatan</span>
                    <span class="text-sm font-black text-slate-800 dark:text-slate-100">${actCount}</span>
                </div>
                <div class="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/60">
                    <span class="text-[10px] text-slate-400 font-bold uppercase block">Dinas Luar</span>
                    <span class="text-sm font-black text-amber-600 dark:text-amber-400">${dlCount} DL</span>
                </div>
            `;
        }
    }

    if (activitiesEl) {
        const renderActCard = (act) => {
            if (act && act.id && _supervisorDetailActivitiesMap) {
                _supervisorDetailActivitiesMap.set(String(act.id), act);
            }
            const title = escapeHTML(act.task_item_name || act.task_name || act.description || 'Aktivitas Pegawai');
            const desc = act.description && act.description !== act.task_item_name ? `<p class="text-xs text-slate-600 dark:text-slate-300 mt-1">${escapeHTML(act.description)}</p>` : '';
            const loc = act.location ? `<div class="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5"><i class="fa-solid fa-location-dot text-emerald-500"></i> ${escapeHTML(act.location)}</div>` : '';
            const output = act.output ? `<div class="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5"><i class="fa-solid fa-box-archive text-blue-500"></i> ${escapeHTML(act.output)}</div>` : '';
            const dlBadge = act.is_outside_duty ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"><i class="fa-solid fa-car-side mr-1"></i>Dinas Luar</span>' : '';

            // Foto Bukti Kegiatan (Maks. 2 Foto)
            const photos = parseEvidencePhotos(act.bukti_url || act.evidence_url);
            const photoCount = photos.length;
            const photoBtn = photoCount > 0 ? `
                <button type="button" onclick="event.stopPropagation(); window.openEmployeeLightbox('${escapeHTML(String(act.id))}')" class="px-2 py-0.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/70 text-emerald-700 dark:text-emerald-300 font-bold text-[10px] flex items-center gap-1 transition-colors border border-emerald-200/80 dark:border-emerald-800/70 shadow-2xs cursor-pointer active:scale-95" title="Buka Foto Bukti Kegiatan (${photoCount} Foto)">
                    <i class="fa-solid fa-camera text-[10px]"></i>
                    <span>${photoCount} Foto Bukti</span>
                </button>
            ` : '';

            return `
                <div class="p-3 bg-slate-50 dark:bg-slate-800/70 rounded-xl border border-slate-200/70 dark:border-slate-700/70">
                    <div class="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-200/50 dark:border-slate-700/50">
                        <div class="flex items-center gap-2">
                            <span class="font-mono text-xs font-black text-emerald-700 dark:text-emerald-300"><i class="fa-regular fa-clock mr-1"></i>${act.start_time} – ${act.end_time}</span>
                            <span class="text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">${act.duration || calculateEffectiveMinutes(act.start_time, act.end_time)}m</span>
                            ${dlBadge}
                        </div>
                        <div>${photoBtn}</div>
                    </div>
                    <div class="mt-2 font-bold text-xs text-slate-800 dark:text-white leading-snug">${title}</div>
                    ${desc}
                    ${loc}
                    ${output}
                </div>
            `;
        };

        const renderAbsenceBanner = (abs) => {
            if (!abs) return '';
            const absType = abs.jenis || abs.absence_type || 'Izin';
            const absReason = abs.alasan || abs.reason || '';
            const reasonHtml = absReason ? `<div class="text-[11px] text-amber-800 dark:text-amber-200 mt-1">${escapeHTML(absReason)}</div>` : '';
            const attachHtml = abs.attachment_url ? `<div class="mt-1.5"><a href="${escapeHTML(abs.attachment_url)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-300 underline hover:text-amber-900"><i class="fa-solid fa-paperclip"></i> Lihat Bukti Surat / Lampiran</a></div>` : '';
            return `
                <div class="p-3 bg-amber-50/80 dark:bg-amber-950/40 rounded-xl border border-amber-200/80 dark:border-amber-800/70">
                    <div class="flex items-center justify-between gap-2">
                        <span class="font-extrabold text-xs text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                            <i class="fa-solid fa-file-medical"></i> Ketidakhadiran Sah: ${escapeHTML(absType)}
                        </span>
                        <span class="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-200 border border-amber-300/60 dark:border-amber-700/60">Tercatat</span>
                    </div>
                    ${reasonHtml}
                    ${attachHtml}
                </div>
            `;
        };

        if (isWeek) {
            const weekDays = supervisorSummaryWeekDays.length === 5 ? supervisorSummaryWeekDays : getWorkWeekDays(selectedSummaryWeekDate);
            let weekHtml = '';
            weekDays.forEach((dStr, idx) => {
                const dayName = INDO_DAYS[idx + 1] || 'Hari';
                const dData = person.daily_breakdown?.[dStr];
                const acts = Array.isArray(dData?.activities) ? dData.activities : [];
                const dayAbs = dData?.absence || null;
                const dMin = Number(dData?.minutes || 0);
                const dHrs = (dMin / 60).toFixed(1);

                weekHtml += `
                    <div class="border border-slate-200 dark:border-slate-700/80 rounded-2xl p-3 bg-white dark:bg-slate-900/60 shadow-2xs">
                        <div class="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800 mb-2">
                            <div class="font-bold text-xs text-slate-700 dark:text-slate-200 flex items-center gap-2">
                                <span class="w-2 h-2 rounded-full ${dMin > 0 ? 'bg-emerald-500' : (dayAbs ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600')}"></span>
                                <span>${dayName}, ${dStr}</span>
                            </div>
                            <span class="text-xs font-bold ${dMin > 0 ? 'text-emerald-600 dark:text-emerald-400' : (dayAbs ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400')}">${dayAbs && dMin === 0 ? `${escapeHTML(dayAbs.jenis || dayAbs.absence_type || 'Izin')} (Sah)` : `${dHrs} Jam (${dMin}m)`}</span>
                        </div>
                        <div class="space-y-2">
                            ${dayAbs ? renderAbsenceBanner(dayAbs) : ''}
                            ${acts.length > 0 ? acts.map(renderActCard).join('') : (dayAbs ? '' : '<div class="text-[11px] text-slate-400 italic py-1">Tidak ada catatan aktivitas pada hari ini.</div>')}
                        </div>
                    </div>
                `;
            });
            activitiesEl.innerHTML = weekHtml;
        } else {
            const dayData = person.daily_breakdown?.[targetDate];
            const acts = Array.isArray(dayData?.activities) ? dayData.activities : [];
            const dayAbs = dayData?.absence || null;
            if (acts.length > 0 || dayAbs) {
                activitiesEl.innerHTML = `${dayAbs ? `<div class="mb-2.5">${renderAbsenceBanner(dayAbs)}</div>` : ''}${acts.map(renderActCard).join('')}`;
            } else {
                activitiesEl.innerHTML = `
                    <div class="text-center py-8 text-slate-400 italic">
                        <i class="fa-regular fa-calendar-xmark text-3xl mb-2 text-slate-300 dark:text-slate-600 block"></i>
                        Belum ada catatan aktivitas pada tanggal ini.
                    </div>
                `;
            }
        }
    }

    if (btnInspect) {
        btnInspect.onclick = () => {
            window.inspectEmployeeLog(empId, person.employee_name);
            window.closeSupervisorDetailModal();
        };
    }

    const btnRecap = document.getElementById('modal-supervisor-detail-btn-recap');
    if (btnRecap) {
        btnRecap.onclick = () => {
            selectedEmployeeGtkId = empId;
            selectedEmployeeUid = empId;
            selectedEmployeeName = person.employee_name || person.name || empId;
            window.closeSupervisorDetailModal();
            window.openEmployeeMonthlyRecapModal();
        };
    }

    modal.classList.remove('hidden');
    if (content) {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }
};

/**
 * Menutup Modal Pop-Up Rincian Kegiatan Pegawai
 */
window.closeSupervisorDetailModal = function() {
    if (_closeSupervisorModalTimer) {
        clearTimeout(_closeSupervisorModalTimer);
        _closeSupervisorModalTimer = null;
    }
    const modal = document.getElementById('modal-supervisor-employee-detail');
    const content = document.getElementById('modal-supervisor-employee-detail-content');
    if (!modal) return;
    if (content) {
        content.classList.remove('scale-100', 'opacity-100');
        content.classList.add('scale-95', 'opacity-0');
    }
    _closeSupervisorModalTimer = setTimeout(() => {
        modal.classList.add('hidden');
        if (content) {
            content.classList.remove('scale-95', 'opacity-0');
            content.classList.add('scale-100', 'opacity-100');
        }
        _closeSupervisorModalTimer = null;
    }, 150);
};

window.inspectEmployeeLog = function(id, name) {
    const select = document.getElementById('select-employee-filter');
    if (select) {
        select.value = id;
    }
    selectedEmployeeGtkId = id;
    selectedEmployeeUid = id;
    selectedEmployeeName = name;

    // Sembunyikan panel monitoring rekapitulasi supervisi
    const summaryPanel = document.getElementById('section-employee-summary-view');
    if (summaryPanel) {
        summaryPanel.classList.add('hidden');
    }

    // Munculkan wrapper tampilan individual untuk merender log pegawai yang diinspeksi
    const individualWrapper = document.getElementById('employee-individual-view-wrapper');
    if (individualWrapper) {
        individualWrapper.classList.remove('hidden');
    }

    // Tampilkan banner inspeksi pegawai dengan nama pegawai yang diinspeksi
    const bannerInspect = document.getElementById('banner-inspecting-employee');
    const bannerName = document.getElementById('banner-inspecting-employee-name');
    if (bannerInspect) bannerInspect.classList.remove('hidden');
    if (bannerName) bannerName.textContent = name || 'Pegawai Terpilih';

    // Default EXPAND Matriks Kinerja Mingguan secara otomatis saat mode inspeksi aktif (permintaan khusus Kepsek)
    const matrixContainer = document.getElementById('container-employee-weekly-matrix');
    const matrixText = document.getElementById('text-toggle-weekly-matrix');
    const matrixIcon = document.getElementById('icon-toggle-weekly-matrix');
    const matrixBtn = document.getElementById('btn-toggle-weekly-matrix');
    const matrixIndicator = document.getElementById('indicator-toggle-weekly-matrix');
    if (matrixContainer) {
        matrixContainer.classList.remove('hidden');
        if (matrixText) matrixText.textContent = 'Sembunyikan';
        if (matrixIcon) matrixIcon.className = 'fa-solid fa-chevron-up text-[9px] transition-transform duration-200';
        if (matrixBtn) matrixBtn.classList.remove('btn-pulse-attention', 'animate-pulse');
        if (matrixIndicator) matrixIndicator.classList.add('hidden');
    }

    // Proteksi: Sembunyikan tombol Catat Aktivitas agar Kepsek tidak salah mencatat aktivitas atas nama pegawai lain
    const btnOpenModal = document.getElementById('btn-open-activity-modal');
    if (btnOpenModal) btnOpenModal.classList.add('hidden');
    const fabWrapper = document.getElementById('fab-open-activity-modal-wrapper');
    if (fabWrapper) fabWrapper.classList.add('hidden');

    loadEmployeeDayData();
    document.getElementById('banner-inspecting-employee')?.scrollIntoView({ behavior: 'smooth' });
};

window.exitEmployeeInspection = async function() {
    const bannerInspect = document.getElementById('banner-inspecting-employee');
    if (bannerInspect) bannerInspect.classList.add('hidden');

    const select = document.getElementById('select-employee-filter');
    if (select) select.value = '';

    selectedEmployeeGtkId = '';
    selectedEmployeeUid = '';
    selectedEmployeeName = '';

    const summaryPanel = document.getElementById('section-employee-summary-view');
    const individualWrapper = document.getElementById('employee-individual-view-wrapper');
    const btnOpenModal = document.getElementById('btn-open-activity-modal');
    const fabWrapper = document.getElementById('fab-open-activity-modal-wrapper');

    if (isMonitoringMode) {
        // Kembali ke tampilan awal Mode Monitoring yang bersih:
        // Munculkan kembali tabel rekapitulasi monitoring
        if (summaryPanel) summaryPanel.classList.remove('hidden');
        // Sembunyikan kembali 3 grid individual
        if (individualWrapper) individualWrapper.classList.add('hidden');
        // Pastikan tombol catat aktivitas tetap tersembunyi selama mode monitoring
        if (btnOpenModal) btnOpenModal.classList.add('hidden');
        if (fabWrapper) fabWrapper.classList.add('hidden');

        updateHeaderContext();

        await loadSupervisorSummary();
        summaryPanel?.scrollIntoView({ behavior: 'smooth' });
    } else {
        // Jika berada di mode pribadi agenda saya
        if (summaryPanel) summaryPanel.classList.add('hidden');
        if (individualWrapper) individualWrapper.classList.remove('hidden');
        if (btnOpenModal) btnOpenModal.classList.remove('hidden');
        if (fabWrapper) fabWrapper.classList.remove('hidden');

        await loadEmployeeDayData();
    }
};

// Keyboard listener: Escape untuk menutup modal supervisi pegawai & lightbox foto
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const lightboxModal = document.getElementById('modal-evidence-lightbox');
        if (lightboxModal && !lightboxModal.classList.contains('hidden')) {
            window.closeEmployeeLightbox();
            return;
        }
        const detailModal = document.getElementById('modal-supervisor-employee-detail');
        if (detailModal && !detailModal.classList.contains('hidden')) {
            window.closeSupervisorDetailModal();
        }
    }
});



window.refreshSupervisorSummary = async function() {
    await loadSupervisorSummary();
};


// =========================================================================
// 11.5 REKAPITULASI REALISASI BULANAN PEGAWAI (SIMAS VIP)
// =========================================================================

let _monthlyRecapYear = new Date().getFullYear().toString();
let _monthlyRecapMonth = String(new Date().getMonth() + 1).padStart(2, '0');
let _currentMonthlyRecapData = null;
let _monthlyRecapExpandedGroups = new Set();
let _monthlyRecapExpandedItems = new Set();

const GROUP_PALETTES = [
    { bg: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', light: 'bg-emerald-50 dark:bg-emerald-950/40', border: 'border-emerald-200 dark:border-emerald-800' },
    { bg: 'bg-indigo-500', text: 'text-indigo-700 dark:text-indigo-300', light: 'bg-indigo-50 dark:bg-indigo-950/40', border: 'border-indigo-200 dark:border-indigo-800' },
    { bg: 'bg-blue-500', text: 'text-blue-700 dark:text-blue-300', light: 'bg-blue-50 dark:bg-blue-950/40', border: 'border-blue-200 dark:border-blue-800' },
    { bg: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300', light: 'bg-amber-50 dark:bg-amber-950/40', border: 'border-amber-200 dark:border-amber-800' },
    { bg: 'bg-purple-500', text: 'text-purple-700 dark:text-purple-300', light: 'bg-purple-50 dark:bg-purple-950/40', border: 'border-purple-200 dark:border-purple-800' },
    { bg: 'bg-teal-500', text: 'text-teal-700 dark:text-teal-300', light: 'bg-teal-50 dark:bg-teal-950/40', border: 'border-teal-200 dark:border-teal-800' },
    { bg: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-300', light: 'bg-rose-50 dark:bg-rose-950/40', border: 'border-rose-200 dark:border-rose-800' },
    { bg: 'bg-cyan-500', text: 'text-cyan-700 dark:text-cyan-300', light: 'bg-cyan-50 dark:bg-cyan-950/40', border: 'border-cyan-200 dark:border-cyan-800' },
    { bg: 'bg-slate-500', text: 'text-slate-700 dark:text-slate-300', light: 'bg-slate-100 dark:bg-slate-800', border: 'border-slate-200 dark:border-slate-700' }
];

/**
 * Membuka Modal Rekapitulasi Realisasi Bulanan Pegawai (VIP)
 */
window.openEmployeeMonthlyRecapModal = async function() {
    // Jika tidak memiliki hak akses VIP dan bukan supervisor, tampilkan notice VIP eksklusif
    if (!isSupervisor && !hasEmployeeVipAccess) {
        window.openEmployeeRekapVipNoticeModal();
        return;
    }

    const modal = document.getElementById('modal-employee-monthly-recap');
    const content = document.getElementById('modal-employee-monthly-recap-content');
    if (!modal || !content) return;

    if (selectedDate && selectedDate.includes('-')) {
        const parts = selectedDate.split('-');
        _monthlyRecapYear = parts[0];
        _monthlyRecapMonth = parts[1];
    } else {
        const now = new Date();
        _monthlyRecapYear = now.getFullYear().toString();
        _monthlyRecapMonth = String(now.getMonth() + 1).padStart(2, '0');
    }

    syncMonthlyRecapControls();

    modal.classList.remove('hidden');
    setTimeout(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }, 10);

    await window.loadEmployeeMonthlyRecapData();
};

/**
 * Menutup Modal Rekapitulasi Realisasi Bulanan Pegawai
 */
window.closeEmployeeMonthlyRecapModal = function() {
    const modal = document.getElementById('modal-employee-monthly-recap');
    const content = document.getElementById('modal-employee-monthly-recap-content');
    if (!modal) return;
    if (content) {
        content.classList.remove('scale-100', 'opacity-100');
        content.classList.add('scale-95', 'opacity-0');
    }
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 200);
};

/**
 * Membuka Modal Notice SIMAS VIP untuk Pegawai Non-Supervisor
 */
window.openEmployeeRekapVipNoticeModal = function() {
    const modal = document.getElementById('modal-employee-rekap-vip-notice');
    if (modal) {
        modal.classList.remove('hidden');
    } else if (window.showToast) {
        window.showToast('SIMAS VIP', 'Akses terbatas dan dalam tahap pengembangan.', 'info');
    }
};

/**
 * Menutup Modal Notice SIMAS VIP
 */
window.closeEmployeeRekapVipNoticeModal = function() {
    const modal = document.getElementById('modal-employee-rekap-vip-notice');
    if (modal) modal.classList.add('hidden');
};

/**
 * Navigasi Bulan Rekapitulasi (-1 untuk bulan lalu, +1 untuk bulan depan)
 */
window.navigateMonthlyRecapMonth = async function(delta) {
    let y = parseInt(_monthlyRecapYear, 10);
    let m = parseInt(_monthlyRecapMonth, 10) + delta;
    if (m > 12) {
        m = 1;
        y += 1;
    } else if (m < 1) {
        m = 12;
        y -= 1;
    }
    _monthlyRecapYear = y.toString();
    _monthlyRecapMonth = String(m).padStart(2, '0');
    syncMonthlyRecapControls();
    await window.loadEmployeeMonthlyRecapData();
};

/**
 * Event Listener saat Dropdown Bulan / Tahun diubah
 */
window.onMonthlyRecapMonthChange = async function() {
    const selMonth = document.getElementById('select-monthly-recap-month');
    const selYear = document.getElementById('select-monthly-recap-year');
    if (selMonth) _monthlyRecapMonth = selMonth.value;
    if (selYear) _monthlyRecapYear = selYear.value;
    await window.loadEmployeeMonthlyRecapData();
};

/**
 * Reset ke Bulan Berjalan
 */
window.setMonthlyRecapCurrentMonth = async function() {
    const now = new Date();
    _monthlyRecapYear = now.getFullYear().toString();
    _monthlyRecapMonth = String(now.getMonth() + 1).padStart(2, '0');
    syncMonthlyRecapControls();
    await window.loadEmployeeMonthlyRecapData();
};

function syncMonthlyRecapControls() {
    const selMonth = document.getElementById('select-monthly-recap-month');
    const selYear = document.getElementById('select-monthly-recap-year');
    if (selMonth) selMonth.value = _monthlyRecapMonth;
    if (selYear) selYear.value = _monthlyRecapYear;
}

/**
 * Memuat Data Rekapitulasi Realisasi Bulanan dari D1 Worker
 */
window.loadEmployeeMonthlyRecapData = async function(isForceReload = false) {
    const itemsContainer = document.getElementById('monthly-recap-items-container');
    if (itemsContainer) {
        itemsContainer.innerHTML = `
            <div class="p-8 text-center bg-slate-50 dark:bg-slate-800/30 rounded-2xl border border-slate-200/80 dark:border-slate-800 text-slate-400 text-xs">
                <i class="fa-solid fa-spinner fa-spin text-2xl mb-2 text-amber-500"></i>
                <p>Memuat rekapitulasi realisasi butir tugas periode ${_monthlyRecapMonth}/${_monthlyRecapYear}...</p>
            </div>
        `;
    }

    const isPersonalMode = !isSupervisor || !isMonitoringMode;
    let targetGtkId = isPersonalMode ? '' : (selectedEmployeeGtkId || '');

    // Khusus Super Admin di Mode Monitoring jika belum memilih pegawai secara spesifik:
    if (!isPersonalMode && !targetGtkId && isSuperAdmin) {
        const allEmps = [...(supervisorSummaryEmployees || []), ...(supervisorSummaryUnassigned || [])];
        if (allEmps.length > 0) {
            const firstEmp = allEmps[0];
            targetGtkId = firstEmp.gtk_id || firstEmp.user_uid || firstEmp.person_id || '';
            selectedEmployeeGtkId = targetGtkId;
            selectedEmployeeName = firstEmp.employee_name || firstEmp.name || '';
        }
    }

    try {
        const queryParams = {
            month: _monthlyRecapMonth,
            year: _monthlyRecapYear
        };

        if (isPersonalMode) {
            queryParams.mode = 'personal';
            queryParams.self = 'true';
            if (currentUserUid) queryParams.user_uid = currentUserUid;
            if (currentUserName) queryParams.employee_name = currentUserName;
        } else if (targetGtkId) {
            queryParams.gtk_id = targetGtkId;
        }

        const res = await cfClient.getEmployeeMonthlyRecap(queryParams);
        const data = res?.data || res;
        _currentMonthlyRecapData = data;

        // 1. Update Identitas Pegawai di Header Modal
        const nameEl = document.getElementById('monthly-recap-employee-name');
        const nipEl = document.getElementById('monthly-recap-employee-nip');
        if (nameEl) {
            nameEl.textContent = isPersonalMode 
                ? (currentUserName || data.employee?.name || 'Kepala Sekolah')
                : (data.employee?.name || selectedEmployeeName || 'Pegawai Tendik');
        }
        if (nipEl) {
            const defaultRole = isPersonalMode ? (isCurrentTargetPrincipal() ? 'Kepala Sekolah' : 'Tenaga Kependidikan') : 'Tenaga Kependidikan';
            const nipText = data.employee?.nip ? `NIP. ${data.employee.nip}` : (data.employee?.jenis_ptk || defaultRole);
            nipEl.textContent = nipText;
        }

        // 2. Update Ringkasan Metrik
        const summary = data.summary || {};
        const period = data.period || {};

        const totalHoursEl = document.getElementById('monthly-recap-total-hours');
        const targetRatioEl = document.getElementById('monthly-recap-target-ratio');
        const actCountEl = document.getElementById('monthly-recap-activity-count');
        const repDaysEl = document.getElementById('monthly-recap-reporting-days');
        const workDaysEl = document.getElementById('monthly-recap-working-days');
        const outsideDutyEl = document.getElementById('monthly-recap-outside-duty');

        if (totalHoursEl) totalHoursEl.textContent = summary.total_effective_hours_formatted || '0 Jam';
        if (targetRatioEl) targetRatioEl.textContent = `(${summary.achievement_percentage || 0}% dari target ${period.target_hours_formatted || '0 Jam'})`;
        if (actCountEl) actCountEl.textContent = `${summary.total_activities || 0} Kegiatan`;
        if (repDaysEl) repDaysEl.textContent = `${summary.reporting_days_count || 0} Hari`;
        if (workDaysEl) workDaysEl.textContent = `${period.working_days || 0} Hari (${period.target_hours_formatted || '0 Jam'})`;
        if (outsideDutyEl) outsideDutyEl.textContent = `${summary.outside_duty_count || 0} Kali`;

        // 3. Render Segmented Progress Bar & Legenda Kelompok Tugas
        renderMonthlyRecapSegmentedBar(data.groups_distribution || [], summary.total_effective_minutes || 0);

        // 4. Render Tabel Rekapitulasi Realisasi per Butir Tugas
        renderMonthlyRecapTaskItemsTable(data.task_items_recap || []);

    } catch (err) {
        console.error('Error loading monthly recap:', err);
        if (itemsContainer) {
            itemsContainer.innerHTML = `
                <div class="p-6 text-center bg-rose-50/50 dark:bg-rose-950/20 rounded-2xl border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs">
                    <i class="fa-solid fa-triangle-exclamation text-2xl mb-2 text-rose-500"></i>
                    <p class="font-bold">Gagal memuat rekapitulasi realisasi</p>
                    <p class="text-[11px] text-slate-500 mt-1">${escapeHTML(err.message || 'Terjadi kesalahan sistem')}</p>
                    <button type="button" onclick="window.loadEmployeeMonthlyRecapData(true)" class="mt-3 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold">
                        Coba Lagi
                    </button>
                </div>
            `;
        }
    }
};

/**
 * Render Segmented Progress Bar & Legenda Kelompok Tugas
 */
function renderMonthlyRecapSegmentedBar(groups, totalMinutes) {
    const barEl = document.getElementById('monthly-recap-segmented-bar');
    const legendEl = document.getElementById('monthly-recap-category-legends');
    if (!barEl || !legendEl) return;

    if (!Array.isArray(groups) || groups.length === 0 || totalMinutes <= 0) {
        barEl.innerHTML = `<div style="width: 100%" class="h-full bg-slate-300 dark:bg-slate-600 flex items-center justify-center text-[10px] text-slate-500 dark:text-slate-400 font-semibold">Belum ada realisasi tercatat</div>`;
        legendEl.innerHTML = `<div class="col-span-full text-slate-400 italic text-[11px]">Belum ada aktivitas pada periode ini.</div>`;
        return;
    }

    // Warna mengikuti indeks asli kelompok agar bar, legenda, dan accordion selalu senada
    const activeGroups = groups
        .map((g, idx) => ({ g, idx }))
        .filter(({ g }) => (g.total_minutes || 0) > 0);

    barEl.innerHTML = activeGroups.map(({ g, idx }) => {
        const pal = GROUP_PALETTES[idx % GROUP_PALETTES.length];
        const pct = g.percentage || 0;
        return `
            <div style="width: ${pct}%" class="h-full ${pal.bg} transition-all duration-300 relative group cursor-pointer" title="${escapeHTML(g.nama_kelompok)}: ${pct}% (${escapeHTML(g.total_hours_formatted)})">
            </div>
        `;
    }).join('');

    legendEl.innerHTML = groups.map((g, idx) => {
        // "Tugas Umum" tanpa realisasi tidak perlu tampil di legenda
        if (g.group_id === 'unmapped' && !((g.total_minutes || 0) > 0)) return '';
        const pal = GROUP_PALETTES[idx % GROUP_PALETTES.length];
        const pct = g.percentage || 0;
        return `
            <div class="flex items-center gap-1.5 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                <span class="w-2.5 h-2.5 rounded-full ${pal.bg} shrink-0"></span>
                <span class="truncate font-semibold text-slate-700 dark:text-slate-200" title="${escapeHTML(g.nama_kelompok)}">${escapeHTML(g.nama_kelompok)}</span>
                <span class="ml-auto font-mono font-bold text-slate-500 dark:text-slate-400 shrink-0">${pct}%</span>
            </div>
        `;
    }).join('');
}

/**
 * Render Tabel Rekapitulasi Realisasi per Butir Tugas Pokok
 */
function renderMonthlyRecapTaskItemsTable(groups) {
    const container = document.getElementById('monthly-recap-items-container');
    if (!container) return;

    if (!Array.isArray(groups) || groups.length === 0) {
        container.innerHTML = `
            <div class="p-8 text-center bg-slate-50 dark:bg-slate-800/30 rounded-2xl border border-slate-200/80 dark:border-slate-800 text-slate-400 text-xs">
                <i class="fa-solid fa-clipboard-check text-2xl mb-2 text-slate-400"></i>
                <p>Tidak ada butir rincian tugas untuk periode ini.</p>
            </div>
        `;
        return;
    }

    if (_monthlyRecapExpandedGroups.size === 0) {
        groups.forEach((g, idx) => {
            if (idx === 0 || (g.total_minutes || 0) > 0) {
                _monthlyRecapExpandedGroups.add(g.group_id);
            }
        });
    }

    container.innerHTML = groups.map((grp, grpIdx) => {
        const pal = GROUP_PALETTES[grpIdx % GROUP_PALETTES.length];
        const isExpanded = _monthlyRecapExpandedGroups.has(grp.group_id);
        const hasRealization = (grp.total_minutes || 0) > 0;
        const items = grp.items || [];
        const realizedItemsCount = items.filter(it => (it.realization_count || 0) > 0).length;

        return `
            <div class="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900 shadow-2xs transition-all">
                <!-- Header Accordion Kelompok Tugas -->
                <button type="button" onclick="window.toggleMonthlyRecapGroup('${escapeHTML(grp.group_id)}')" class="w-full px-4 py-3 bg-slate-50/70 hover:bg-slate-100/70 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer">
                    <div class="flex items-center gap-2.5 min-w-0">
                        <span class="w-6 h-6 rounded-lg ${pal.bg} text-white flex items-center justify-center font-bold text-xs shrink-0">
                            ${escapeHTML(grp.kode_kelompok || 'SK')}
                        </span>
                        <div class="min-w-0">
                            <div class="flex items-center gap-2">
                                <h5 class="font-bold text-slate-800 dark:text-white text-xs sm:text-sm truncate">
                                    ${escapeHTML(grp.nama_kelompok)}
                                </h5>
                                ${grp.is_assigned ? `<span class="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 shrink-0">SK Utama</span>` : ''}
                            </div>
                            <p class="text-[11px] text-slate-400 mt-0.5">
                                Terlaksana ${realizedItemsCount} dari ${items.length} butir tugas pokok
                            </p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2.5 shrink-0">
                        <div class="text-right">
                            <div class="text-xs font-black ${hasRealization ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}">
                                ${escapeHTML(grp.total_hours_formatted || '0 Jam')}
                            </div>
                            <div class="text-[10px] text-slate-400 font-mono">${grp.percentage || 0}% porsi</div>
                        </div>
                        <i class="fa-solid fa-chevron-down text-xs text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}"></i>
                    </div>
                </button>

                <!-- Tabel Butir Rincian Tugas (Collapsible Body) -->
                <div class="${isExpanded ? 'block' : 'hidden'} border-t border-slate-200/80 dark:border-slate-800">
                    <div class="overflow-x-auto custom-scrollbar">
                        <table class="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr class="bg-slate-50/50 dark:bg-slate-800/30 text-slate-400 font-bold uppercase text-[9px] tracking-wider border-b border-slate-200 dark:border-slate-800">
                                    <th class="py-2.5 px-3 text-center w-14">Kode</th>
                                    <th class="py-2.5 px-3 min-w-[280px]">Uraian Butir Rincian Tugas Pokok</th>
                                    <th class="py-2.5 px-3 text-center w-24">Realisasi</th>
                                    <th class="py-2.5 px-3 text-center w-28">Total Durasi</th>
                                    <th class="py-2.5 px-3 text-right w-28 whitespace-nowrap">Rincian</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-100 dark:divide-slate-800/60">
                                ${items.map((it, itIdx) => {
                                    const isRealized = (it.realization_count || 0) > 0;
                                    const isItemDetailOpen = _monthlyRecapExpandedItems.has(it.item_id);
                                    const activities = it.activities || [];

                                    return `
                                        <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors ${isRealized ? 'bg-emerald-50/20 dark:bg-emerald-950/10' : ''}">
                                            <td class="py-2.5 px-3 text-center font-bold text-slate-500 dark:text-slate-400 font-mono">
                                                ${escapeHTML(it.kode_butir || String(itIdx + 1))}
                                            </td>
                                            <td class="py-2.5 px-3 font-medium text-slate-700 dark:text-slate-200 leading-relaxed">
                                                <div>${escapeHTML(it.uraian_tugas)}</div>
                                            </td>
                                            <td class="py-2.5 px-3 text-center">
                                                ${isRealized 
                                                    ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">${it.realization_count}x</span>` 
                                                    : `<span class="text-slate-400 font-mono text-[10px]">0x</span>`}
                                            </td>
                                            <td class="py-2.5 px-3 text-center font-bold ${isRealized ? 'text-slate-800 dark:text-white' : 'text-slate-400'}">
                                                ${escapeHTML(it.total_hours_formatted || '-')}
                                            </td>
                                            <td class="py-2.5 px-3 text-right">
                                                ${isRealized && activities.length > 0 
                                                    ? `<div class="flex items-center justify-end gap-1">
                                                    <button type="button" onclick="window.openEmployeeButirPrint('${escapeHTML(it.item_id)}')" class="w-7 h-7 rounded-lg text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 flex items-center justify-center transition-colors cursor-pointer" title="Cetak infografis butir tugas ini (1 lembar A4)" aria-label="Cetak infografis butir tugas">
                                                        <i class="fa-solid fa-print text-[11px]"></i>
                                                    </button>
                                                    <button type="button" onclick="window.toggleMonthlyRecapItemDetails('${escapeHTML(it.item_id)}')" class="px-2 py-1 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 rounded-lg transition-colors flex items-center gap-1 ml-auto cursor-pointer">
                                                        <span>${isItemDetailOpen ? 'Tutup' : 'Lihat'}</span>
                                                        <i class="fa-solid fa-chevron-down text-[9px] transition-transform ${isItemDetailOpen ? 'rotate-180' : ''}"></i>
                                                    </button>
                                                    </div>` 
                                                    : `<span class="text-slate-400 text-[10px] italic">-</span>`}
                                            </td>
                                        </tr>
                                        ${isItemDetailOpen && activities.length > 0 ? `
                                            <tr class="bg-indigo-50/30 dark:bg-indigo-950/20 border-b border-indigo-100 dark:border-indigo-900/40">
                                                <td colspan="5" class="p-3 sm:p-4">
                                                    <div class="space-y-2">
                                                        <div class="text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5">
                                                            <i class="fa-solid fa-clock-rotate-left"></i>
                                                            <span>Log Realisasi Butir Tugas (${activities.length} Kegiatan)</span>
                                                        </div>
                                                        <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                            ${activities.map(act => `
                                                                <div class="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs space-y-1">
                                                                    <div class="flex items-center justify-between text-[11px]">
                                                                        <span class="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                                                                            <i class="fa-regular fa-calendar text-emerald-500"></i> ${escapeHTML(act.tanggal)}
                                                                        </span>
                                                                        <span class="font-mono text-emerald-600 dark:text-emerald-400 font-bold">${escapeHTML(act.jam_mulai)} - ${escapeHTML(act.jam_selesai)} (${act.durasi_menit}m)</span>
                                                                    </div>
                                                                    <p class="text-slate-600 dark:text-slate-300 font-medium">${escapeHTML(act.uraian_kegiatan)}</p>
                                                                    ${act.hasil_output ? `<div class="text-[10px] text-slate-400"><span class="font-semibold text-slate-500">Output:</span> ${escapeHTML(act.hasil_output)}</div>` : ''}
                                                                </div>
                                                            `).join('')}
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        ` : ''}
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Toggle Accordion Kelompok Tugas
 */
window.toggleMonthlyRecapGroup = function(groupId) {
    if (_monthlyRecapExpandedGroups.has(groupId)) {
        _monthlyRecapExpandedGroups.delete(groupId);
    } else {
        _monthlyRecapExpandedGroups.add(groupId);
    }
    if (_currentMonthlyRecapData && _currentMonthlyRecapData.task_items_recap) {
        renderMonthlyRecapTaskItemsTable(_currentMonthlyRecapData.task_items_recap);
    }
};

/**
 * Toggle Detail Kegiatan pada Butir Tugas
 */
window.toggleMonthlyRecapItemDetails = function(itemId) {
    if (_monthlyRecapExpandedItems.has(itemId)) {
        _monthlyRecapExpandedItems.delete(itemId);
    } else {
        _monthlyRecapExpandedItems.add(itemId);
    }
    if (_currentMonthlyRecapData && _currentMonthlyRecapData.task_items_recap) {
        renderMonthlyRecapTaskItemsTable(_currentMonthlyRecapData.task_items_recap);
    }
};

// =========================================================================
// CETAK INFOGRAFIS PER BUTIR TUGAS (ALA CANVA, 1 LEMBAR A4)
// Template bersama dengan E-Kinerja Guru: js/rekap-infographic.js
// =========================================================================

// Batas kegiatan per lembar (foto tendik maks. 2 per kegiatan sehingga muat 6 kartu)
export const EMP_REPORT_MAX_ACTIVITIES = 6;
export const EMP_REPORT_MAX_PAGES = 5;
const EMP_REPORT_MAX_PHOTOS = MAX_EMPLOYEE_PHOTOS;

const _empPrint = {
    itemId: null,
    orientation: 'portrait',
    range: null,          // { start, end } indeks minggu; null = sebulan penuh
    rangeMonth: '',
    selected: new Set(),
    pages: [new Set()],   // Multi-page builder
    localPhotos: {},      // { [activityId]: [dataUrl] } — hanya untuk cetak, tidak diunggah
    photoCaptions: {},    // { [`${activityId}_${photoIdx}`]: captionText }
    drawerOpen: false,
    signatureDataUrl: '',
    signHasContent: false,
    signInited: false,
    drawing: false
};

function syncEmpPrintSelected() {
    _empPrint.selected = new Set((_empPrint.pages || []).flatMap(p => Array.from(p)));
}

function getRecapMonthKey(data) {
    const y = parseInt(data?.period?.year, 10);
    const m = parseInt(data?.period?.month, 10);
    return y && m ? `${y}-${String(m).padStart(2, '0')}` : '';
}

function findRecapButir(data, itemId) {
    for (const group of (Array.isArray(data?.task_items_recap) ? data.task_items_recap : [])) {
        const item = (group.items || []).find(it => String(it.item_id) === String(itemId));
        if (item) return { group, item };
    }
    return { group: null, item: null };
}

function formatMinutesShort(total) {
    const h = Math.floor((total || 0) / 60);
    const m = (total || 0) % 60;
    return h > 0 ? `${h}j ${m}m` : `${m}m`;
}

// Gabungan foto bukti (Google Drive) + foto lokal khusus cetak, dipotong maks. 2
function collectEmployeeActivityPhotos(act, localPhotos = {}) {
    const photos = [];
    const actId = String(act.id);
    parseEvidencePhotos(act.bukti_url).forEach(photo => {
        if (!photo) return;
        const fileId = photo.fileId || extractGoogleDriveFileId(photo.url);
        photos.push({
            url: fileId ? `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}=w1200` : photo.url,
            caption: photo.caption || (!isGenericCaption(photo.name) ? photo.name : '') || ''
        });
    });
    ((localPhotos && localPhotos[actId]) || []).forEach(url => photos.push({ url, caption: '' }));
    return photos.slice(0, EMP_REPORT_MAX_PHOTOS).map((p, idx) => {
        const key = `${actId}_${idx}`;
        const overriddenCaption = Object.prototype.hasOwnProperty.call(_empPrint.photoCaptions, key)
            ? _empPrint.photoCaptions[key]
            : p.caption;
        return {
            ...p,
            caption: overriddenCaption
        };
    });
}

/**
 * Bangun dokumen HTML cetak infografis satu butir rincian tugas.
 * Fungsi murni: tidak menyentuh DOM halaman, sehingga dapat diuji dan di-preview.
 * @param {object} data - Respons /api/employee-agenda/monthly-recap
 * @param {string} itemId - item_id butir pada task_items_recap
 * @param {object} [options] - { orientation, selectedIds: Set, localPhotos, range, signatureDataUrl, schoolConfig, today }
 */
export function buildEmployeeButirInfographicHtml(data, itemId, options = {}) {
    const { group, item } = findRecapButir(data, itemId);
    const emp = data?.employee || {};
    const cfg = options.schoolConfig || {};
    const schoolName = cfg.schoolName || "SMA Negeri Nusantara";
    const schoolCity = cfg.schoolCity || 'Denpasar';
    const monthKey = getRecapMonthKey(data);
    const period = resolveRekapReportPeriod(monthKey, options.range || null);

    const scope = (item?.activities || [])
        .filter(a => isDateInRekapPeriod(a.tanggal, period))
        .sort((a, b) => (a.tanggal || '').localeCompare(b.tanggal || '') || (a.jam_mulai || '').localeCompare(b.jam_mulai || ''));
    const selected = (options.selectedIds instanceof Set
        ? scope.filter(a => options.selectedIds.has(String(a.id)))
        : scope.slice()
    ).slice(0, EMP_REPORT_MAX_ACTIVITIES);

    // Titimangsa: hari terakhir periode, tetapi tidak melewati tanggal cetak (rekap bulan berjalan)
    const today = options.today instanceof Date ? options.today : new Date();
    let signDate = today;
    if (period.end) {
        const [y, m, d] = period.end.split('-').map(v => parseInt(v, 10));
        const endDate = new Date(y, m - 1, d);
        if (endDate < today) signDate = endDate;
    }
    const titimangsa = `${schoolCity}, ${signDate.getDate()} ${REKAP_MONTH_NAMES[signDate.getMonth()]} ${signDate.getFullYear()}`;

    const mapEmpActToInfographic = (act) => ({
        date: act.tanggal,
        timeStr: act.jam_mulai ? `${act.jam_mulai}–${act.jam_selesai || ''}` : '',
        title: act.uraian_kegiatan || 'Kegiatan',
        chips: [
            { text: `⏱ ${formatMinutesShort(act.durasi_menit)}`, kind: 'dur' },
            act.is_outside_duty
                ? { text: `📍 Dinas Luar${act.dl_lokasi ? ': ' + act.dl_lokasi : ''}`, kind: 'wait' }
                : { text: '🏫 Di Sekolah', kind: 'info' }
        ],
        output: act.hasil_output || '',
        photos: collectEmployeeActivityPhotos(act, options.localPhotos)
    });

    let pagesData = null;
    let selectedActs = selected;
    if (Array.isArray(options.pages) && options.pages.length > 0) {
        pagesData = options.pages.map(pageSet => {
            const pageActs = scope.filter(a => pageSet.has(String(a.id))).slice(0, EMP_REPORT_MAX_ACTIVITIES);
            return pageActs.map(mapEmpActToInfographic);
        });
        selectedActs = scope.filter(a => options.pages.some(p => p.has(String(a.id))));
    }

    const n = selectedActs.length;
    const totalMinutes = selectedActs.reduce((acc, a) => acc + (a.durasi_menit || 0), 0);
    const activeDays = new Set(selectedActs.map(a => a.tanggal).filter(Boolean)).size;
    const outsideCount = selectedActs.filter(a => a.is_outside_duty).length;

    const activities = pagesData ? (pagesData[0] || []) : selected.map(mapEmpActToInfographic);

    const scopeNote = scope.length > n
        ? `Menampilkan ${n} dari ${scope.length} kegiatan pada periode ini`
        : `${scope.length} kegiatan pada periode ini`;

    return buildRekapInfographicHtml({
        orientation: options.orientation,
        docTitle: `Laporan Kegiatan - ${item?.uraian_tugas || 'Butir Tugas'} - ${emp.name || ''}`,
        schoolName,
        kicker: 'Jurnal Kegiatan Tendik',
        title: item?.uraian_tugas || 'Butir Rincian Tugas',
        subtitle: [item?.kode_butir && item.kode_butir !== '-' ? `Butir ${item.kode_butir}` : '', group?.nama_kelompok || ''].filter(Boolean).join(' · '),
        person: { name: emp.name, nip: emp.nip, role: emp.jenis_ptk || 'Tenaga Kependidikan' },
        period: { shortLabel: period.shortLabel, rangeText: period.rangeText },
        titimangsa,
        stats: [
            { ico: '⏱', val: formatMinutesShort(totalMinutes), lbl: 'Total waktu' },
            { ico: '✦', val: `${n} Kegiatan`, lbl: 'Ditampilkan' },
            { ico: '🗓', val: `${activeDays} Hari`, lbl: 'Hari aktif' },
            { ico: '📍', val: `${outsideCount}x`, lbl: 'Dinas luar' }
        ],
        activities,
        pages: pagesData,
        footTitle: 'Rekap Realisasi Kinerja Tendik',
        footLines: [scopeNote, 'Dibuat melalui SIMAS E-Kinerja Tendik'],
        signatureDataUrl: options.signatureDataUrl || ''
    });
}

function getEmpPrintPeriod() {
    const monthKey = getRecapMonthKey(_currentMonthlyRecapData);
    // Rentang minggu hanya berlaku untuk bulan saat rentang itu dipilih
    if (_empPrint.rangeMonth !== monthKey) {
        _empPrint.range = null;
        _empPrint.rangeMonth = monthKey;
    }
    return resolveRekapReportPeriod(monthKey, _empPrint.range);
}

function getEmpPrintScope() {
    const { item } = findRecapButir(_currentMonthlyRecapData, _empPrint.itemId);
    const period = getEmpPrintPeriod();
    return (item?.activities || [])
        .filter(a => isDateInRekapPeriod(a.tanggal, period))
        .sort((a, b) => (a.tanggal || '').localeCompare(b.tanggal || '') || (a.jam_mulai || '').localeCompare(b.jam_mulai || ''));
}

function empActivityPhotoCount(act) {
    return parseEvidencePhotos(act.bukti_url).length + (_empPrint.localPhotos[String(act.id)] || []).length;
}

function autoSelectEmpPrintActivities() {
    const picked = pickRekapReportActivities(getEmpPrintScope(), a => empActivityPhotoCount(a) > 0, EMP_REPORT_MAX_ACTIVITIES);
    _empPrint.pages = [new Set(picked.map(a => String(a.id)))];
    syncEmpPrintSelected();
}

function setEmpPrintDrawerOpen(isOpen) {
    _empPrint.drawerOpen = !!isOpen;
    document.getElementById('panel-emp-print-drawer')?.classList.toggle('hidden', !_empPrint.drawerOpen);
    document.getElementById('icon-emp-print-drawer')?.classList.toggle('rotate-180', _empPrint.drawerOpen);
}

function updateEmpPrintOrientationUI() {
    const active = 'px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-2xs cursor-pointer';
    const idle = 'px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white cursor-pointer';
    const btnP = document.getElementById('btn-emp-print-orient-portrait');
    const btnL = document.getElementById('btn-emp-print-orient-landscape');
    const hint = document.getElementById('emp-print-scale-hint');
    if (btnP) btnP.className = _empPrint.orientation === 'portrait' ? active : idle;
    if (btnL) btnL.className = _empPrint.orientation === 'landscape' ? active : idle;
    if (hint) {
        hint.textContent = _empPrint.orientation === 'landscape'
            ? 'A4 Landscape (297 × 210 mm)'
            : 'A4 Portrait (210 × 297 mm)';
    }
}

function updateEmpPrintHeader() {
    const { item } = findRecapButir(_currentMonthlyRecapData, _empPrint.itemId);
    const titleEl = document.getElementById('emp-print-modal-title');
    if (titleEl) titleEl.textContent = `Laporan Butir ${item?.kode_butir && item.kode_butir !== '-' ? item.kode_butir + ' - ' : ''}${item?.uraian_tugas || ''}`;
    const subtitleEl = document.getElementById('emp-print-modal-subtitle');
    if (subtitleEl) {
        const empName = _currentMonthlyRecapData?.employee?.name || '-';
        syncEmpPrintSelected();
        const pageCount = _empPrint.pages.length;
        const totalSelected = _empPrint.selected.size;
        subtitleEl.textContent = `${empName} · ${getEmpPrintPeriod().label} · ${pageCount} Lembar (${totalSelected} kegiatan terpilih)`;
    }
}

export function addEmployeeButirPrintPage() {
    if (_empPrint.pages.length >= EMP_REPORT_MAX_PAGES) {
        if (window.showToast) window.showToast('Batas Halaman', `Maksimal ${EMP_REPORT_MAX_PAGES} halaman per laporan cetak.`, 'warning');
        return;
    }
    syncEmpPrintSelected();
    const remainingScope = getEmpPrintScope().filter(a => !_empPrint.selected.has(String(a.id)));
    const autoPicked = pickRekapReportActivities(remainingScope, a => empActivityPhotoCount(a) > 0, EMP_REPORT_MAX_ACTIVITIES);
    _empPrint.pages.push(new Set(autoPicked.map(a => String(a.id))));
    syncEmpPrintSelected();
    renderEmpPrintActivityList();
    updateEmpPrintHeader();
    refreshEmpPrintPreview();
}

export function removeEmployeeButirPrintPage(pageIdx) {
    if (_empPrint.pages.length <= 1) return;
    const pIdx = parseInt(pageIdx, 10);
    if (pIdx >= 0 && pIdx < _empPrint.pages.length) {
        _empPrint.pages.splice(pIdx, 1);
        syncEmpPrintSelected();
        renderEmpPrintActivityList();
        updateEmpPrintHeader();
        refreshEmpPrintPreview();
    }
}

export function toggleEmployeeButirActivityForPage(pageIdx, actId, isChecked) {
    const safeIdx = parseInt(pageIdx, 10) || 0;
    if (!_empPrint.pages[safeIdx]) _empPrint.pages[safeIdx] = new Set();
    const pageSet = _empPrint.pages[safeIdx];
    const sId = String(actId);

    if (isChecked) {
        if (pageSet.size >= EMP_REPORT_MAX_ACTIVITIES) {
            if (window.showToast) window.showToast('Batas Kegiatan', `Maksimal ${EMP_REPORT_MAX_ACTIVITIES} kegiatan per lembar. Hapus centang salah satu atau tambah lembar baru.`, 'warning');
            renderEmpPrintActivityList();
            return;
        }
        _empPrint.pages.forEach((p, idx) => {
            if (idx !== safeIdx) p.delete(sId);
        });
        pageSet.add(sId);
    } else {
        pageSet.delete(sId);
    }
    syncEmpPrintSelected();
    renderEmpPrintActivityList();
    updateEmpPrintHeader();
    refreshEmpPrintPreview();
}
window.addEmployeeButirPrintPage = addEmployeeButirPrintPage;
window.removeEmployeeButirPrintPage = removeEmployeeButirPrintPage;
window.toggleEmployeeButirActivityForPage = toggleEmployeeButirActivityForPage;

function renderEmpPrintPeriodChips() {
    const wrap = document.getElementById('emp-print-period-chips');
    const hint = document.getElementById('emp-print-period-hint');
    if (!wrap) return;
    const period = getEmpPrintPeriod();
    wrap.innerHTML = buildRekapPeriodChipsHtml(getRecapMonthKey(_currentMonthlyRecapData), period, _empPrint.range, {
        full: 'window.setEmployeeButirPeriodFull()',
        week: 'window.setEmployeeButirPeriodWeek'
    });
    if (hint) {
        hint.innerHTML = `Periode aktif: <strong class="text-emerald-700 dark:text-emerald-300">${escapeHTML(period.label)}</strong> · <span class="font-semibold text-slate-700 dark:text-slate-200">${getEmpPrintScope().length} kegiatan tersedia</span>. <span class="text-slate-400 text-[10.5px] hidden sm:inline">(Klik satu minggu, lalu klik minggu lain untuk rentang)</span>`;
    }
}

function renderEmpPrintActivityList() {
    const listEl = document.getElementById('emp-print-activity-list');
    const countEl = document.getElementById('emp-print-selected-count');
    syncEmpPrintSelected();
    if (countEl) countEl.textContent = `${_empPrint.selected.size}`;
    if (!listEl) return;

    const activities = getEmpPrintScope();
    if (activities.length === 0) {
        listEl.innerHTML = `<div class="p-3 text-center text-xs text-slate-400">Tidak ada kegiatan pada periode ini. Coba pilih minggu lain atau Sebulan Penuh.</div>`;
        return;
    }

    const overflowNotice = activities.length > EMP_REPORT_MAX_ACTIVITIES ? `
        <div class="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-[11px] text-amber-800 dark:text-amber-200 flex items-start gap-2">
            <i class="fa-solid fa-lightbulb mt-0.5 text-amber-500"></i>
            <span>Ada <strong>${activities.length} kegiatan</strong> pada periode ini. Setiap lembar memuat maks. <strong>${EMP_REPORT_MAX_ACTIVITIES} kegiatan</strong> agar foto tampil tajam & proporsional. Gunakan tombol <strong>+ Tambah Halaman</strong> di bawah untuk menyusun laporan multi-lembar dalam 1 berkas.</span>
        </div>
    ` : '';

    const pagesToolbarHtml = `
        <div class="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-700/80 gap-2 flex-wrap">
            <div class="flex items-center gap-2">
                <span class="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <i class="fa-solid fa-layer-group text-emerald-500"></i>
                    <span>Penyusunan Multi-Halaman: <strong>${_empPrint.pages.length} Lembar</strong></span>
                </span>
            </div>
            <div class="flex items-center gap-1.5">
                <button type="button" onclick="window.addEmployeeButirPrintPage()" class="h-7 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold flex items-center gap-1 shadow-2xs transition-all cursor-pointer" title="Tambah lembar halaman berikutnya (maks. ${EMP_REPORT_MAX_PAGES} lembar)">
                    <i class="fa-solid fa-plus text-[10px]"></i> <span>Tambah Halaman</span>
                </button>
            </div>
        </div>
    `;

    const pagesSectionsHtml = _empPrint.pages.map((pageSet, pageIdx) => {
        const pageCount = pageSet.size;
        const isPageFull = pageCount >= EMP_REPORT_MAX_ACTIVITIES;

        const activitiesListHtml = activities.map((act) => {
            const actId = String(act.id);
            const safeId = escapeHTML(actId).replace(/'/g, '&#39;');
            const isChecked = pageSet.has(actId);
            const otherPageIdx = _empPrint.pages.findIndex((p, idx) => idx !== pageIdx && p.has(actId));
            const isLockedByOther = otherPageIdx !== -1;
            const isLockedByFull = !isChecked && isPageFull;
            const isLocked = isLockedByOther || isLockedByFull;

            const cloudPhotos = parseEvidencePhotos(act.bukti_url);
            const localPhotos = _empPrint.localPhotos[actId] || [];
            const canAddPhoto = cloudPhotos.length + localPhotos.length < EMP_REPORT_MAX_PHOTOS;

            const allPhotos = [];
            const thumbs = [];

            cloudPhotos.forEach((p) => {
                const fId = p.fileId || extractGoogleDriveFileId(p.url);
                const src = fId ? `https://lh3.googleusercontent.com/d/${encodeURIComponent(fId)}=w120` : p.url;
                thumbs.push(`<img src="${escapeHTML(src)}" class="w-7 h-7 rounded object-cover border border-slate-200" title="Foto bukti tersimpan" onerror="this.style.display='none'">`);
                const pIdx = allPhotos.length;
                const capKey = `${actId}_${pIdx}`;
                const capVal = Object.prototype.hasOwnProperty.call(_empPrint.photoCaptions, capKey)
                    ? _empPrint.photoCaptions[capKey]
                    : (p.caption || (!isGenericCaption(p.name) ? p.name : '') || '');
                allPhotos.push({ src, capVal, isLocal: false, localIdx: -1 });
            });

            localPhotos.forEach((src, lIdx) => {
                thumbs.push(`
                    <div class="relative group/ph inline-block">
                        <img src="${src}" class="w-7 h-7 rounded object-cover border border-indigo-400" title="Foto lokal khusus cetak">
                        <button type="button" onclick="window.removeEmployeeButirLocalPhoto('${safeId}', ${lIdx})" class="absolute -top-1 -right-1 w-3.5 h-3.5 bg-rose-500 text-white rounded-full flex items-center justify-center text-[8px] hover:bg-rose-600 cursor-pointer" title="Hapus foto lokal">×</button>
                    </div>
                `);
                const pIdx = allPhotos.length;
                const capKey = `${actId}_${pIdx}`;
                const capVal = Object.prototype.hasOwnProperty.call(_empPrint.photoCaptions, capKey)
                    ? _empPrint.photoCaptions[capKey]
                    : '';
                allPhotos.push({ src, capVal, isLocal: true, localIdx: lIdx });
            });

            const lockTitle = isLockedByOther
                ? `Sudah dipilih di Halaman ${otherPageIdx + 1}`
                : (isLockedByFull ? `Maksimal ${EMP_REPORT_MAX_ACTIVITIES} kegiatan per lembar` : '');

            const photoCaptionsEditorHtml = (isChecked && allPhotos.length > 0) ? `
                <div class="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-1.5 w-full">
                    <div class="text-[10px] font-bold text-slate-600 dark:text-slate-300 flex items-center justify-between">
                        <span class="flex items-center gap-1"><i class="fa-solid fa-tags text-[9px] text-emerald-600"></i> Caption Foto (${allPhotos.length}):</span>
                        <span class="text-[9px] text-slate-400">Tampil pada sel foto cetak</span>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        ${allPhotos.map((ph, phIdx) => `
                            <div class="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800/60 p-1.5 rounded-lg border border-slate-200/80 dark:border-slate-700/80 min-w-0">
                                <div class="relative shrink-0">
                                    <img src="${escapeHTML(ph.src)}" class="w-8 h-8 rounded object-cover border border-slate-200 dark:border-slate-700" alt="" onerror="this.style.display='none'">
                                    <span class="absolute -top-1 -left-1 px-1 rounded-full bg-slate-800 text-[8px] font-bold text-white">${phIdx + 1}</span>
                                </div>
                                <textarea
                                    rows="2"
                                    placeholder="Caption foto ${phIdx + 1}..."
                                    oninput="window.updateEmployeeButirPhotoCaption('${safeId}', ${phIdx}, this.value)"
                                    class="flex-1 min-w-0 text-[10px] leading-snug px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-white placeholder:text-slate-400 focus:outline-hidden focus:ring-1 focus:ring-emerald-500 resize-none overflow-y-auto"
                                    title="Caption untuk foto ${phIdx + 1}"
                                >${escapeHTML(ph.capVal)}</textarea>
                                ${ph.isLocal ? `
                                    <button type="button" onclick="window.removeEmployeeButirLocalPhoto('${safeId}', ${ph.localIdx})" class="w-5 h-5 rounded-md bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-300 flex items-center justify-center text-[10px] shrink-0 cursor-pointer" title="Hapus foto lokal">
                                        <i class="fa-solid fa-trash-can text-[9px]"></i>
                                    </button>
                                ` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : '';

            return `
                <div class="p-2 sm:p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-col justify-between gap-2 transition-colors ${isChecked ? 'ring-1 ring-emerald-500/30' : (isLockedByOther ? 'opacity-40 bg-slate-50/50 dark:bg-slate-950/40' : 'opacity-70')}">
                    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 w-full">
                        <div class="flex items-start gap-2.5 min-w-0 flex-1">
                            <input type="checkbox" ${isChecked ? 'checked' : ''} ${isLocked ? `disabled title="${escapeHTML(lockTitle)}"` : ''} onchange="window.toggleEmployeeButirActivityForPage(${pageIdx}, '${safeId}', this.checked)" class="mt-1 rounded text-emerald-600 focus:ring-emerald-500 ${isLocked ? 'cursor-not-allowed' : 'cursor-pointer'} shrink-0">
                            <div class="min-w-0">
                                <div class="text-xs font-bold text-slate-800 dark:text-white truncate flex items-center gap-2">
                                    <span class="truncate">${escapeHTML(act.uraian_kegiatan || 'Kegiatan')}</span>
                                    ${isLockedByOther ? `<span class="shrink-0 px-1.5 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[9px] font-bold">Dipilih di Hal ${otherPageIdx + 1}</span>` : ''}
                                </div>
                                <div class="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap">
                                    <span><i class="fa-regular fa-calendar text-[9px]"></i> ${escapeHTML(act.tanggal || '-')}</span>
                                    <span>•</span>
                                    <span><i class="fa-regular fa-clock text-[9px]"></i> ${escapeHTML(act.jam_mulai || '')}–${escapeHTML(act.jam_selesai || '')} (${formatMinutesShort(act.durasi_menit)})</span>
                                    ${act.is_outside_duty ? '<span class="px-1.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-bold">Dinas Luar</span>' : ''}
                                </div>
                            </div>
                        </div>
                        <div class="flex items-center gap-2 shrink-0 self-end sm:self-center">
                            <div class="flex items-center gap-1">${thumbs.join('')}</div>
                            ${canAddPhoto ? `
                            <label class="h-6 px-2 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-colors" title="Unggah foto lokal khusus cetak ini (maks. ${EMP_REPORT_MAX_PHOTOS} foto per kegiatan)">
                                <i class="fa-solid fa-camera text-[9px]"></i>
                                <span>+ Foto</span>
                                <input type="file" accept="image/jpeg,image/png,image/webp" class="hidden" onchange="window.uploadEmployeeButirLocalPhoto('${safeId}', this)">
                            </label>` : `<span class="text-[10px] font-semibold text-slate-400" title="Batas foto per kegiatan tercapai">Maks. ${EMP_REPORT_MAX_PHOTOS} foto</span>`}
                        </div>
                    </div>
                    ${photoCaptionsEditorHtml}
                </div>
            `;
        }).join('');

        return `
            <div class="p-3 rounded-2xl border border-slate-200 dark:border-slate-700/80 bg-slate-50/70 dark:bg-slate-800/40 space-y-2.5">
                <div class="flex items-center justify-between gap-2 flex-wrap">
                    <div class="flex items-center gap-2">
                        <span class="px-2 py-0.5 rounded-lg bg-slate-800 text-white dark:bg-emerald-600 text-xs font-extrabold tracking-wide">
                            Halaman ${pageIdx + 1}
                        </span>
                        <span class="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                            (${pageCount}/${EMP_REPORT_MAX_ACTIVITIES} Terpilih)
                        </span>
                    </div>
                    <div class="flex items-center gap-1.5">
                        <button type="button" onclick="window.toggleEmployeeButirPrintSelectAll(true, ${pageIdx})" class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:text-emerald-600 cursor-pointer shadow-2xs">
                            Pilih Cepat
                        </button>
                        <button type="button" onclick="window.toggleEmployeeButirPrintSelectAll(false, ${pageIdx})" class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:text-rose-600 cursor-pointer shadow-2xs">
                            Kosongkan
                        </button>
                        ${pageIdx > 0 ? `
                            <button type="button" onclick="window.removeEmployeeButirPrintPage(${pageIdx})" class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-300 hover:bg-rose-100 cursor-pointer flex items-center gap-1" title="Hapus lembar ini">
                                <i class="fa-solid fa-trash-can text-[9px]"></i> Hapus Lembar
                            </button>
                        ` : ''}
                    </div>
                </div>
                <div class="space-y-1.5">
                    ${activitiesListHtml}
                </div>
            </div>
        `;
    }).join('');

    listEl.innerHTML = overflowNotice + pagesToolbarHtml + `<div class="space-y-3">${pagesSectionsHtml}</div>`;
}

function refreshEmpPrintPreview() {
    const frame = document.getElementById('emp-print-preview-frame');
    if (!frame || !_currentMonthlyRecapData || !_empPrint.itemId) return;
    syncEmpPrintSelected();
    frame.srcdoc = buildEmployeeButirInfographicHtml(_currentMonthlyRecapData, _empPrint.itemId, {
        orientation: _empPrint.orientation,
        selectedIds: _empPrint.selected,
        pages: _empPrint.pages,
        localPhotos: _empPrint.localPhotos,
        range: _empPrint.range,
        signatureDataUrl: _empPrint.signatureDataUrl,
        schoolConfig: window.SCHOOL_CONFIG || {}
    });
    fitRekapPreviewFrame(frame, _empPrint.orientation, _empPrint.pages.length);
}

function updateEmpSignBadge() {
    const badge = document.getElementById('emp-print-sign-badge');
    if (!badge) return;
    badge.textContent = _empPrint.signHasContent ? 'Tanda Tangan Siap' : 'Belum Ada TTD';
    badge.className = _empPrint.signHasContent
        ? 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
        : 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300';
}

function initEmpSignatureCanvas() {
    const canvas = document.getElementById('emp-print-signature-canvas');
    if (!canvas || _empPrint.signInited) return;
    _empPrint.signInited = true;
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';

    const getPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        return [(e.clientX - rect.left) * (canvas.width / rect.width), (e.clientY - rect.top) * (canvas.height / rect.height)];
    };
    canvas.addEventListener('pointerdown', (e) => {
        _empPrint.drawing = true;
        ctx.beginPath();
        ctx.moveTo(...getPos(e));
    });
    canvas.addEventListener('pointermove', (e) => {
        if (!_empPrint.drawing) return;
        e.preventDefault();
        ctx.lineTo(...getPos(e));
        ctx.stroke();
        _empPrint.signHasContent = true;
    });
    const stop = () => {
        if (!_empPrint.drawing) return;
        _empPrint.drawing = false;
        _empPrint.signatureDataUrl = canvas.toDataURL('image/png');
        updateEmpSignBadge();
        refreshEmpPrintPreview();
    };
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(evt => canvas.addEventListener(evt, stop));
}

function onEmpPrintPeriodChanged() {
    autoSelectEmpPrintActivities();
    updateEmpPrintHeader();
    renderEmpPrintPeriodChips();
    renderEmpPrintActivityList();
    refreshEmpPrintPreview();
}

window.openEmployeeButirPrint = function(itemId) {
    if (!_currentMonthlyRecapData) {
        if (window.showToast) window.showToast('Data Belum Siap', 'Silakan tunggu data rekapitulasi selesai dimuat.', 'warning');
        return;
    }
    const { item } = findRecapButir(_currentMonthlyRecapData, itemId);
    if (!item) return;
    if (_empPrint.itemId !== String(itemId)) {
        _empPrint.localPhotos = {};
        _empPrint.photoCaptions = {};
    }
    _empPrint.itemId = String(itemId);

    autoSelectEmpPrintActivities();
    updateEmpPrintHeader();
    updateEmpPrintOrientationUI();
    renderEmpPrintPeriodChips();
    renderEmpPrintActivityList();
    setEmpPrintDrawerOpen(getEmpPrintScope().length > EMP_REPORT_MAX_ACTIVITIES);

    document.getElementById('modal-employee-butir-print')?.classList.remove('hidden');
    initEmpSignatureCanvas();
    updateEmpSignBadge();
    refreshEmpPrintPreview();
};

window.closeEmployeeButirPrintModal = function() {
    document.getElementById('modal-employee-butir-print')?.classList.add('hidden');
};

window.printEmployeeButirReport = function() {
    const frame = document.getElementById('emp-print-preview-frame');
    if (!frame || !frame.contentWindow) return;
    try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
    } catch (e) {
        console.error('Print dialog error:', e);
        if (window.showToast) window.showToast('Gagal Membuka Dialog Cetak', e.message, 'error');
    }
};

window.refreshEmpPrintPreview = function() {
    refreshEmpPrintPreview();
};

window.setEmployeeButirPrintOrientation = function(orientation) {
    _empPrint.orientation = orientation === 'landscape' ? 'landscape' : 'portrait';
    updateEmpPrintOrientationUI();
    refreshEmpPrintPreview();
};

window.toggleEmployeeButirPrintDrawer = function() {
    setEmpPrintDrawerOpen(!_empPrint.drawerOpen);
};

window.setEmployeeButirPeriodFull = function() {
    _empPrint.range = null;
    _empPrint.rangeMonth = getRecapMonthKey(_currentMonthlyRecapData);
    onEmpPrintPeriodChanged();
};

window.setEmployeeButirPeriodWeek = function(weekIdx) {
    const period = getEmpPrintPeriod();
    _empPrint.range = nextRekapWeekRange(period.isFullMonth ? null : _empPrint.range, weekIdx);
    _empPrint.rangeMonth = getRecapMonthKey(_currentMonthlyRecapData);
    onEmpPrintPeriodChanged();
};

export function toggleEmployeeButirPrintActivity(actId, isChecked) {
    toggleEmployeeButirActivityForPage(0, actId, isChecked);
}
window.toggleEmployeeButirPrintActivity = toggleEmployeeButirPrintActivity;

export function toggleEmployeeButirPrintSelectAll(selectAll, pageIdx = 0) {
    const safeIdx = parseInt(pageIdx, 10) || 0;
    if (!_empPrint.pages[safeIdx]) _empPrint.pages[safeIdx] = new Set();

    if (selectAll) {
        const otherSelected = new Set(
            _empPrint.pages.flatMap((p, idx) => idx !== safeIdx ? Array.from(p) : [])
        );
        const available = getEmpPrintScope().filter(a => !otherSelected.has(String(a.id)));
        const picked = pickRekapReportActivities(available, a => empActivityPhotoCount(a) > 0, EMP_REPORT_MAX_ACTIVITIES);
        _empPrint.pages[safeIdx] = new Set(picked.map(a => String(a.id)));
    } else {
        _empPrint.pages[safeIdx] = new Set();
    }
    syncEmpPrintSelected();
    renderEmpPrintActivityList();
    updateEmpPrintHeader();
    refreshEmpPrintPreview();
}
window.toggleEmployeeButirPrintSelectAll = toggleEmployeeButirPrintSelectAll;

window.uploadEmployeeButirLocalPhoto = async function(actId, fileInput) {
    const file = fileInput?.files?.[0];
    if (fileInput) fileInput.value = '';
    if (!file) return;
    const act = getEmpPrintScope().find(a => String(a.id) === String(actId));
    if (act && empActivityPhotoCount(act) >= EMP_REPORT_MAX_PHOTOS) {
        if (window.showToast) window.showToast('Batas Foto', `Maksimal ${EMP_REPORT_MAX_PHOTOS} foto per kegiatan.`, 'warning');
        return;
    }
    try {
        const { dataUrl } = await compressImageToJpegBase64(file, 1600, 0.82, 0);
        const key = String(actId);
        _empPrint.localPhotos[key] = [...(_empPrint.localPhotos[key] || []), dataUrl];
        renderEmpPrintActivityList();
        refreshEmpPrintPreview();
    } catch (err) {
        if (window.showToast) window.showToast('Foto Tidak Valid', err.message, 'error');
    }
};

window.removeEmployeeButirLocalPhoto = function(actId, photoIdx) {
    const list = _empPrint.localPhotos[String(actId)];
    if (!list || !list[photoIdx]) return;
    list.splice(photoIdx, 1);
    const act = getEmpPrintScope().find(a => String(a.id) === String(actId));
    const cloudCount = act ? parseEvidencePhotos(act.bukti_url).length : 0;
    const targetKey = `${actId}_${cloudCount + photoIdx}`;
    delete _empPrint.photoCaptions[targetKey];
    renderEmpPrintActivityList();
    refreshEmpPrintPreview();
};

export function updateEmployeeButirPhotoCaption(actId, photoIdx, newCaption) {
    const key = `${actId}_${photoIdx}`;
    _empPrint.photoCaptions[key] = String(newCaption || '').trim();
    refreshEmpPrintPreview();
}
window.updateEmployeeButirPhotoCaption = updateEmployeeButirPhotoCaption;
window.addEmployeeButirPrintPage = addEmployeeButirPrintPage;
window.removeEmployeeButirPrintPage = removeEmployeeButirPrintPage;
window.toggleEmployeeButirActivityForPage = toggleEmployeeButirActivityForPage;

window.clearEmployeeButirSignature = function() {
    const canvas = document.getElementById('emp-print-signature-canvas');
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    _empPrint.signHasContent = false;
    _empPrint.signatureDataUrl = '';
    updateEmpSignBadge();
    refreshEmpPrintPreview();
};

// =========================================================================
// 12. KELOLA MASTER PENUGASAN PEGAWAI (Super Admin & Kepala Sekolah)
// =========================================================================

let allGtkList = [];
let filteredAssignmentsList = [];
let currentManageTab = 'assignments';

/**
 * Membuka Modal Kelola Master Penugasan Pegawai
 */
window.openManageAssignmentsModal = async function(initialTab = 'assignments') {
    if (!isSupervisor) {
        if (window.showToast) window.showToast('Akses Dibatasi', 'Hanya Super Admin dan Kepala Sekolah yang dapat mengelola penugasan.', 'warning');
        return;
    }

    const modal = document.getElementById('modal-manage-assignments');
    const content = document.getElementById('modal-manage-assignments-content');
    if (!modal || !content) return;

    // Reset dan tutup seluruh formulir agar tampilan awal langsung fokus pada data tabel
    if (typeof window.toggleAssignmentForm === 'function') window.toggleAssignmentForm(false);
    if (typeof window.toggleGroupForm === 'function') window.toggleGroupForm(false);
    if (typeof window.toggleItemForm === 'function') window.toggleItemForm(false);
    if (typeof window.togglePrincipalGroupForm === 'function') window.togglePrincipalGroupForm(false);

    const btnVipTab = document.getElementById('btn-tab-manage-vip');
    if (btnVipTab) {
        if (isSuperAdmin) {
            btnVipTab.classList.remove('hidden');
        } else {
            btnVipTab.classList.add('hidden');
        }
    }

    if (initialTab && typeof window.switchManageTab === 'function') {
        window.switchManageTab(initialTab);
    }

    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    });

    await refreshManageData();
};

/**
 * Alias Membuka Modal Butir Tugas Pokok Kepala Sekolah
 */
window.openPrincipalTasksModal = function() {
    window.openManageAssignmentsModal('principal');
};

/**
 * Menutup Modal Kelola Master Penugasan Pegawai
 */
window.closeManageAssignmentsModal = function() {
    const modal = document.getElementById('modal-manage-assignments');
    const content = document.getElementById('modal-manage-assignments-content');
    if (!modal || !content) return;

    content.classList.remove('scale-100', 'opacity-100');
    content.classList.add('scale-95', 'opacity-0');

    setTimeout(() => {
        modal.classList.add('hidden');
        // Refresh master task options and staff dropdown in main view
        populateActivityGroupOptions();
        loadStaffOptions();
    }, 200);
};

/**
 * Berpindah Tab pada Modal Kelola Penugasan
 */
window.switchManageTab = function(tabName) {
    currentManageTab = tabName;

    const tabs = ['assignments', 'groups', 'items', 'principal', 'vip'];
    tabs.forEach(t => {
        const btn = document.getElementById(`btn-tab-manage-${t}`);
        const pane = document.getElementById(`pane-manage-${t}`);
        if (t === tabName) {
            btn?.classList.remove('border-transparent', 'text-slate-500', 'dark:text-slate-400');
            btn?.classList.add('border-indigo-600', 'text-indigo-600', 'dark:text-indigo-400');
            pane?.classList.remove('hidden');
        } else {
            btn?.classList.remove('border-indigo-600', 'text-indigo-600', 'dark:text-indigo-400');
            btn?.classList.add('border-transparent', 'text-slate-500', 'dark:text-slate-400');
            pane?.classList.add('hidden');
        }
    });

    if (tabName === 'vip' && typeof window.loadVipSettingsData === 'function') {
        window.loadVipSettingsData();
    }
};

/**
 * Toggle Collapse/Expand Formulir Penugasan Staf
 */
window.toggleAssignmentForm = function(forceState) {
    const container = document.getElementById('container-form-assignment');
    const icon = document.getElementById('icon-toggle-assignment-form');
    const text = document.getElementById('text-toggle-assignment-form');
    const btn = document.getElementById('btn-toggle-assignment-form');
    if (!container) return;

    const isCurrentlyHidden = container.classList.contains('hidden');
    const shouldOpen = typeof forceState === 'boolean' ? forceState : isCurrentlyHidden;

    if (shouldOpen) {
        container.classList.remove('hidden');
        if (icon) icon.className = 'fa-solid fa-chevron-up text-xs';
        if (text) text.textContent = 'Tutup Form';
        if (btn) {
            btn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
            btn.classList.add('bg-slate-600', 'hover:bg-slate-700');
        }
    } else {
        container.classList.add('hidden');
        if (icon) icon.className = 'fa-solid fa-plus-circle text-xs';
        if (text) text.textContent = 'Tambah Penugasan';
        if (btn) {
            btn.classList.remove('bg-slate-600', 'hover:bg-slate-700');
            btn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
        }
    }
};

/**
 * Toggle Collapse/Expand Formulir Kelompok Tugas
 */
window.toggleGroupForm = function(forceState) {
    const container = document.getElementById('container-form-group');
    const icon = document.getElementById('icon-toggle-group-form');
    const text = document.getElementById('text-toggle-group-form');
    const btn = document.getElementById('btn-toggle-group-form');
    if (!container) return;

    const isCurrentlyHidden = container.classList.contains('hidden');
    const shouldOpen = typeof forceState === 'boolean' ? forceState : isCurrentlyHidden;

    if (shouldOpen) {
        container.classList.remove('hidden');
        if (icon) icon.className = 'fa-solid fa-chevron-up text-xs';
        if (text) text.textContent = 'Tutup Form';
        if (btn) {
            btn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
            btn.classList.add('bg-slate-600', 'hover:bg-slate-700');
        }
    } else {
        container.classList.add('hidden');
        if (icon) icon.className = 'fa-solid fa-plus-circle text-xs';
        if (text) text.textContent = 'Tambah Kelompok';
        if (btn) {
            btn.classList.remove('bg-slate-600', 'hover:bg-slate-700');
            btn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
        }
    }
};

/**
 * Toggle Collapse/Expand Formulir Butir Rincian Tugas
 */
window.toggleItemForm = function(forceState) {
    const container = document.getElementById('container-form-item');
    const icon = document.getElementById('icon-toggle-item-form');
    const text = document.getElementById('text-toggle-item-form');
    const btn = document.getElementById('btn-toggle-item-form');
    if (!container) return;

    const isCurrentlyHidden = container.classList.contains('hidden');
    const shouldOpen = typeof forceState === 'boolean' ? forceState : isCurrentlyHidden;

    if (shouldOpen) {
        container.classList.remove('hidden');
        if (icon) icon.className = 'fa-solid fa-chevron-up text-xs';
        if (text) text.textContent = 'Tutup Form';
        if (btn) {
            btn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
            btn.classList.add('bg-slate-600', 'hover:bg-slate-700');
        }
    } else {
        container.classList.add('hidden');
        if (icon) icon.className = 'fa-solid fa-plus-circle text-xs';
        if (text) text.textContent = 'Tambah Butir';
        if (btn) {
            btn.classList.remove('bg-slate-600', 'hover:bg-slate-700');
            btn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
        }
    }
};

/**
 * Memuat & Merefresh Seluruh Data Master Penugasan dari Cloudflare D1
 */
async function refreshManageData() {
    try {
        // 1. Ambil daftar GTK (Master Staf & Tendik via D1) jika belum ada
        if (allGtkList.length === 0) {
            try {
                const gtkRes = await cfClient.getGtk();
                allGtkList = Array.isArray(gtkRes) ? gtkRes : (gtkRes?.data || []);
            } catch (gtkErr) {
                console.warn('[refreshManageData] Gagal memuat GTK via D1:', gtkErr);
            }
        }

        // 2. Ambil master Kelompok Tugas & Butir Tugas
        await loadMasterSkData();

        // 3. Ambil seluruh penugasan pegawai (D1 SSOT)
        try {
            const asgRes = await cfClient.getEmployeeAssignments({});
            allAssignmentsList = Array.isArray(asgRes) ? asgRes : (asgRes?.data || []);
            filteredAssignmentsList = [...allAssignmentsList];
        } catch (asgErr) {
            console.warn('[refreshManageData] Gagal memuat penugasan:', asgErr);
            allAssignmentsList = [];
            filteredAssignmentsList = [];
        }

        // 4. Perbarui dropdown formulir
        populateManageSelects();

        // 5. Render tabel
        renderManageAssignmentsTable();
        renderManageGroupsTable();
        renderManageItemsTable();
        renderManagePrincipalGroupsTable();

        // 6. Perbarui counter badge
        updateManageBadges();

    } catch (err) {
        console.error('[refreshManageData] Error:', err);
    }
}

/**
 * Mengisi Dropdown Select pada Form Modal Manajemen
 */
function populateManageSelects() {
    // Dropdown Pegawai GTK (Hanya Nama dan NIP jika ada, tanpa role guru_mapel)
    const gtkSelect = document.getElementById('assign-form-gtk');
    if (gtkSelect) {
        const currentVal = gtkSelect.value;
        const sortedGtk = [...allGtkList].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        gtkSelect.innerHTML = '<option value="">-- Pilih Pegawai (GTK) --</option>' +
            sortedGtk.map(g => {
                const nip = (g.nip && String(g.nip).trim() !== '-' && String(g.nip).trim() !== '') ? String(g.nip).trim() : '';
                const nipText = nip ? ` (NIP: ${nip})` : '';
                return `<option value="${escapeHTML(g.id)}">${escapeHTML(g.name || 'Tanpa Nama')}${escapeHTML(nipText)}</option>`;
            }).join('');
        if (currentVal) gtkSelect.value = currentVal;
    }

    // Inisialisasi & sinkronisasi Searchable Combobox Pegawai
    setupAssignGtkCombobox();
    syncAssignGtkSearchDisplay();

    const groups = masterSkData?.groups || [];

    // Dropdown Kelompok Tugas pada Form Penugasan
    const assignGroupSelect = document.getElementById('assign-form-group');
    if (assignGroupSelect) {
        const currentVal = assignGroupSelect.value;
        assignGroupSelect.innerHTML = '<option value="">-- Pilih Kelompok Tugas --</option>' +
            groups.map(g => `<option value="${escapeHTML(g.id)}">${escapeHTML(g.kode_kelompok || g.group_code || '')} - ${escapeHTML(g.nama_kelompok || g.group_name || '')}</option>`).join('');
        if (currentVal) assignGroupSelect.value = currentVal;
    }

    // Dropdown Kelompok Tugas pada Form Butir Tugas
    const itemGroupSelect = document.getElementById('item-form-group');
    if (itemGroupSelect) {
        const currentVal = itemGroupSelect.value;
        itemGroupSelect.innerHTML = '<option value="">-- Pilih Kelompok Tugas --</option>' +
            groups.map(g => `<option value="${escapeHTML(g.id)}">${escapeHTML(g.kode_kelompok || g.group_code || '')} - ${escapeHTML(g.nama_kelompok || g.group_name || '')}</option>`).join('');
        if (currentVal) itemGroupSelect.value = currentVal;
    }

    // Dropdown Filter Kelompok Tugas pada Tabel Butir Tugas
    const filterItemGroupSelect = document.getElementById('filter-item-by-group');
    if (filterItemGroupSelect) {
        const currentVal = filterItemGroupSelect.value || 'all';
        filterItemGroupSelect.innerHTML = '<option value="all">Semua Kelompok Tugas</option>' +
            groups.map(g => `<option value="${escapeHTML(g.id)}">${escapeHTML(g.kode_kelompok || g.group_code || '')} - ${escapeHTML(g.nama_kelompok || g.group_name || '')}</option>`).join('');
        filterItemGroupSelect.value = currentVal;
    }
}

// =========================================================================
// SEARCHABLE COMBOBOX PEGAWAI GTK (FORM PENUGASAN)
// =========================================================================
let _isAssignGtkComboboxInit = false;

function setupAssignGtkCombobox() {
    if (_isAssignGtkComboboxInit) return;
    const searchInput = document.getElementById('assign-gtk-search');
    const dropdown = document.getElementById('assign-gtk-dropdown');
    const container = document.getElementById('container-assign-gtk');
    if (!searchInput || !dropdown) return;

    _isAssignGtkComboboxInit = true;

    // Event input pencarian live
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        const clearBtn = document.getElementById('btn-clear-assign-gtk');
        if (clearBtn) {
            if (e.target.value.length > 0) clearBtn.classList.remove('hidden');
            else clearBtn.classList.add('hidden');
        }
        window.renderAssignGtkDropdownOptions(query);
        window.openAssignGtkDropdown();
    });

    // Event focus input: buka dropdown langsung
    searchInput.addEventListener('focus', () => {
        const query = searchInput.value.trim();
        window.renderAssignGtkDropdownOptions(query);
        window.openAssignGtkDropdown();
    });

    // Menutup dropdown saat klik di luar area container
    document.addEventListener('click', (e) => {
        if (container && !container.contains(e.target)) {
            window.closeAssignGtkDropdown();
        }
    });

    // Navigasi Keyboard pada Input
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            window.closeAssignGtkDropdown();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            window.openAssignGtkDropdown();
            const firstBtn = dropdown.querySelector('button[data-gtk-id]');
            if (firstBtn) firstBtn.focus();
        }
    });

    // Navigasi Keyboard di dalam Dropdown List
    dropdown.addEventListener('keydown', (e) => {
        const buttons = Array.from(dropdown.querySelectorAll('button'));
        const activeIdx = buttons.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (activeIdx >= 0 && activeIdx < buttons.length - 1) {
                buttons[activeIdx + 1].focus();
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (activeIdx > 0) {
                buttons[activeIdx - 1].focus();
            } else {
                searchInput.focus();
            }
        } else if (e.key === 'Escape') {
            window.closeAssignGtkDropdown();
            searchInput.focus();
        }
    });
}

function syncAssignGtkSearchDisplay() {
    const gtkSelect = document.getElementById('assign-form-gtk');
    const searchInput = document.getElementById('assign-gtk-search');
    const clearBtn = document.getElementById('btn-clear-assign-gtk');
    if (!searchInput) return;

    const val = gtkSelect?.value;
    if (val) {
        const selected = allGtkList.find(g => String(g.id) === String(val));
        if (selected) {
            const nip = (selected.nip && String(selected.nip).trim() !== '-' && String(selected.nip).trim() !== '') ? String(selected.nip).trim() : '';
            searchInput.value = nip ? `${selected.name || 'Tanpa Nama'} (NIP: ${nip})` : (selected.name || 'Tanpa Nama');
            if (clearBtn) clearBtn.classList.remove('hidden');
            return;
        }
    }

    if (!val) {
        searchInput.value = '';
        if (clearBtn) clearBtn.classList.add('hidden');
    }
}

window.openAssignGtkDropdown = function() {
    const dropdown = document.getElementById('assign-gtk-dropdown');
    const chevron = document.getElementById('icon-assign-gtk-chevron');
    const searchInput = document.getElementById('assign-gtk-search');
    if (dropdown) dropdown.classList.remove('hidden');
    if (chevron) chevron.classList.add('rotate-180');
    if (searchInput) searchInput.setAttribute('aria-expanded', 'true');
};

window.closeAssignGtkDropdown = function() {
    const dropdown = document.getElementById('assign-gtk-dropdown');
    const chevron = document.getElementById('icon-assign-gtk-chevron');
    const searchInput = document.getElementById('assign-gtk-search');
    if (dropdown) dropdown.classList.add('hidden');
    if (chevron) chevron.classList.remove('rotate-180');
    if (searchInput) searchInput.setAttribute('aria-expanded', 'false');
};

window.toggleAssignGtkDropdown = function(event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById('assign-gtk-dropdown');
    if (!dropdown) return;
    if (dropdown.classList.contains('hidden')) {
        const searchInput = document.getElementById('assign-gtk-search');
        const query = searchInput ? searchInput.value.trim() : '';
        window.renderAssignGtkDropdownOptions(query);
        window.openAssignGtkDropdown();
        searchInput?.focus();
    } else {
        window.closeAssignGtkDropdown();
    }
};

window.renderAssignGtkDropdownOptions = function(query = '') {
    const dropdown = document.getElementById('assign-gtk-dropdown');
    if (!dropdown) return;

    const currentVal = document.getElementById('assign-form-gtk')?.value || '';
    const lower = query.toLowerCase().trim();

    const sortedGtk = [...allGtkList].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const filtered = sortedGtk.filter(g => {
        if (!lower) return true;
        const nameMatch = (g.name || '').toLowerCase().includes(lower);
        const nipMatch = (g.nip || '').toLowerCase().includes(lower);
        return nameMatch || nipMatch;
    });

    let html = `
        <button type="button" onclick="window.clearAssignGtkSelection()"
            class="w-full text-left px-3.5 py-2.5 bg-slate-50/80 dark:bg-slate-700/50 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-700/60">
            <span class="text-xs text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1.5">
                <i class="fa-solid fa-user-slash text-slate-400 text-[11px]"></i>
                -- Pilih Pegawai (GTK) --
            </span>
            ${!currentVal ? '<i class="fa-solid fa-check text-indigo-600 dark:text-indigo-400 text-xs font-bold"></i>' : ''}
        </button>
    `;

    if (filtered.length === 0) {
        html += `
            <div class="p-4 text-center text-xs text-slate-400 italic">
                <i class="fa-solid fa-user-xmark text-base mb-1 block opacity-60"></i>
                Tidak ditemukan pegawai dengan kata kunci "${escapeHTML(query)}"
            </div>
        `;
    } else {
        filtered.forEach(g => {
            const isSelected = String(g.id) === String(currentVal);
            const nip = (g.nip && String(g.nip).trim() !== '-' && String(g.nip).trim() !== '') ? String(g.nip).trim() : '';
            const nipDisplay = nip ? `<span class="text-[11px] text-slate-400 font-mono">(NIP: ${escapeHTML(nip)})</span>` : '';

            html += `
                <button type="button" data-gtk-id="${escapeHTML(g.id)}" onclick="window.selectAssignGtk('${escapeHTML(g.id)}', '${escapeHTML(g.name || '')}', '${escapeHTML(nip)}')"
                    class="w-full text-left px-3.5 py-2.5 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors flex items-center justify-between gap-2 ${isSelected ? 'bg-indigo-50/90 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-bold' : 'text-slate-700 dark:text-slate-200'}">
                    <div class="min-w-0 flex-1 flex items-center gap-1.5 flex-wrap">
                        <span class="text-xs font-semibold">${escapeHTML(g.name || 'Tanpa Nama')}</span>
                        ${nipDisplay}
                    </div>
                    ${isSelected ? '<i class="fa-solid fa-check text-indigo-600 dark:text-indigo-400 text-xs shrink-0 font-bold"></i>' : ''}
                </button>
            `;
        });
    }

    dropdown.innerHTML = html;
};

window.selectAssignGtk = function(id, name, nip) {
    const gtkSelect = document.getElementById('assign-form-gtk');
    const searchInput = document.getElementById('assign-gtk-search');
    const clearBtn = document.getElementById('btn-clear-assign-gtk');

    if (gtkSelect) {
        gtkSelect.value = id;
    }
    if (searchInput) {
        searchInput.value = nip ? `${name} (NIP: ${nip})` : name;
    }
    if (clearBtn) clearBtn.classList.remove('hidden');

    window.closeAssignGtkDropdown();
    window.onAssignGtkSelect();
};

window.clearAssignGtkSelection = function() {
    const gtkSelect = document.getElementById('assign-form-gtk');
    const searchInput = document.getElementById('assign-gtk-search');
    const clearBtn = document.getElementById('btn-clear-assign-gtk');

    if (gtkSelect) gtkSelect.value = '';
    if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
    }
    if (clearBtn) clearBtn.classList.add('hidden');

    window.closeAssignGtkDropdown();
    window.onAssignGtkSelect();
};

/**
 * Perbarui Counter Badge pada Tab Navigasi
 */
function updateManageBadges() {
    const bAsg = document.getElementById('badge-count-assignments');
    const bGrp = document.getElementById('badge-count-groups');
    const bItm = document.getElementById('badge-count-items');
    const bVip = document.getElementById('badge-count-vip');

    if (bAsg) bAsg.textContent = String(allAssignmentsList.length);
    if (bGrp) bGrp.textContent = String((masterSkData?.groups || []).length);
    if (bItm) bItm.textContent = String((masterSkData?.items || []).length);
    if (bVip) {
        if (_vipConfig?.all_tendik) {
            bVip.textContent = 'Semua';
        } else {
            const tendikPopulation = typeof getTendikGtkList === 'function' ? getTendikGtkList() : [];
            const tendikIds = new Set(tendikPopulation.map(g => String(g.id)));
            const selectedTendikCount = tendikIds.size > 0
                ? (_vipConfig?.allowed_gtk_ids || []).filter(id => tendikIds.has(String(id))).length
                : (_vipConfig?.allowed_gtk_ids || []).length;
            bVip.textContent = String(selectedTendikCount);
        }
    }
}

// -------------------------------------------------------------------------
// Bagian 12.1: Manajemen Penugasan Staf (Assignments)
// -------------------------------------------------------------------------

/**
 * Render Tabel Penugasan Pegawai
 */
function renderManageAssignmentsTable() {
    const tbody = document.getElementById('table-manage-assignments-body');
    const labelCount = document.getElementById('label-assignment-count');
    if (!tbody) return;

    if (labelCount) {
        labelCount.textContent = `${filteredAssignmentsList.length} Penugasan`;
    }

    if (filteredAssignmentsList.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center py-8 text-slate-400 italic">
                    <i class="fa-solid fa-user-slash text-2xl mb-2 text-slate-300 block"></i>
                    Belum ada data penugasan pegawai yang cocok.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filteredAssignmentsList.map(a => {
        const assistantBadge = a.is_assistant
            ? '<span class="ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">Asisten</span>'
            : '';

        const roleBadge = (a.peran_rincian || a.role_title || '').toLowerCase().includes('koordinator')
            ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">Koordinator</span>'
            : `<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">${escapeHTML(a.peran_rincian || a.role_title || 'Anggota')}</span>`;

        const nipInfo = a.employee_nip ? `<div class="text-[10px] text-slate-400">NIP. ${escapeHTML(a.employee_nip)}</div>` : '';
        const groupCode = a.group_code ? `<span class="font-bold text-indigo-500 mr-1">[${escapeHTML(a.group_code)}]</span>` : '';

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                <td class="py-2.5 px-3 font-semibold text-slate-800 dark:text-white">
                    <div class="flex items-center gap-1.5">
                        <span>${escapeHTML(a.employee_name || 'Tanpa Nama')}</span>
                        ${assistantBadge}
                    </div>
                    ${nipInfo}
                </td>
                <td class="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                    ${groupCode}${escapeHTML(a.group_name || a.nama_kelompok || '-')}
                </td>
                <td class="py-2.5 px-3">
                    ${roleBadge}
                </td>
                <td class="py-2.5 px-3 text-slate-500 text-xs max-w-xs truncate">
                    ${escapeHTML(a.custom_task_scope || a.notes || '-')}
                </td>
                <td class="py-2.5 px-3 text-right whitespace-nowrap">
                    <button type="button" onclick="window.editAssignmentItem('${escapeHTML(a.id)}')" class="w-7 h-7 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-all inline-flex items-center justify-center mr-1" title="Ubah Penugasan">
                        <i class="fa-solid fa-pen text-xs"></i>
                    </button>
                    <button type="button" onclick="window.deleteAssignmentItem('${escapeHTML(a.id)}', '${escapeHTML(a.employee_name || '')}', '${escapeHTML(a.group_name || '')}')" class="w-7 h-7 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-all inline-flex items-center justify-center" title="Hapus Penugasan">
                        <i class="fa-solid fa-trash-can text-xs"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Filter Pencarian Daftar Penugasan
 */
window.filterAssignmentsList = function() {
    const q = (document.getElementById('input-search-assignments')?.value || '').toLowerCase().trim();
    if (!q) {
        filteredAssignmentsList = [...allAssignmentsList];
    } else {
        filteredAssignmentsList = allAssignmentsList.filter(a => {
            const name = (a.employee_name || '').toLowerCase();
            const grp = (a.group_name || a.nama_kelompok || '').toLowerCase();
            const role = (a.peran_rincian || a.role_title || '').toLowerCase();
            const nip = (a.employee_nip || '').toLowerCase();
            return name.includes(q) || grp.includes(q) || role.includes(q) || nip.includes(q);
        });
    }
    renderManageAssignmentsTable();
};

/**
 * Auto-suggest Peran saat GTK dipilih
 */
window.onAssignGtkSelect = function() {
    const gtkSelect = document.getElementById('assign-form-gtk');
    const roleInput = document.getElementById('assign-form-role');
    if (!gtkSelect || !roleInput) return;

    const val = gtkSelect.value;
    if (!val) return;

    const selected = allGtkList.find(g => String(g.id) === String(val));
    if (selected && !roleInput.value) {
        if (selected.role && selected.role.toLowerCase().includes('koordinator')) {
            roleInput.value = 'Koordinator';
        } else {
            roleInput.value = 'Anggota';
        }
    }
};

/**
 * Reset Formulir Penugasan
 */
window.resetAssignmentForm = function() {
    const form = document.getElementById('form-manage-assignment');
    if (form) form.reset();
    const idEl = document.getElementById('assign-form-id');
    if (idEl) idEl.value = '';
    window.clearAssignGtkSelection();
    const heading = document.getElementById('assign-form-heading');
    if (heading) heading.innerHTML = '<i class="fa-solid fa-user-plus text-indigo-500"></i> Form Tambah / Ubah Penugasan Pegawai';
};

/**
 * Edit Baris Penugasan
 */
window.editAssignmentItem = function(id) {
    const item = allAssignmentsList.find(a => String(a.id) === String(id));
    if (!item) return;

    // Buka formulir jika sedang tertutup (collapsible)
    if (typeof window.toggleAssignmentForm === 'function') {
        window.toggleAssignmentForm(true);
    }

    document.getElementById('assign-form-id').value = item.id;
    document.getElementById('assign-form-gtk').value = item.gtk_id || '';

    // Sinkronkan input pencarian combobox pegawai
    const selectedGtk = allGtkList.find(g => String(g.id) === String(item.gtk_id));
    const searchInput = document.getElementById('assign-gtk-search');
    const clearBtn = document.getElementById('btn-clear-assign-gtk');
    if (selectedGtk && searchInput) {
        const nip = (selectedGtk.nip && String(selectedGtk.nip).trim() !== '-' && String(selectedGtk.nip).trim() !== '') ? String(selectedGtk.nip).trim() : '';
        searchInput.value = nip ? `${selectedGtk.name || 'Tanpa Nama'} (NIP: ${nip})` : (selectedGtk.name || 'Tanpa Nama');
        if (clearBtn) clearBtn.classList.remove('hidden');
    } else if (searchInput) {
        searchInput.value = item.employee_name || '';
        if (clearBtn) {
            if (item.employee_name) clearBtn.classList.remove('hidden');
            else clearBtn.classList.add('hidden');
        }
    }

    document.getElementById('assign-form-group').value = item.group_id || '';
    document.getElementById('assign-form-role').value = item.peran_rincian || item.role_title || '';
    document.getElementById('assign-form-scope').value = item.custom_task_scope || item.notes || '';
    document.getElementById('assign-form-is-assistant').checked = Boolean(item.is_assistant);

    const heading = document.getElementById('assign-form-heading');
    if (heading) heading.innerHTML = `<i class="fa-solid fa-user-pen text-amber-500"></i> Ubah Penugasan: <strong>${escapeHTML(item.employee_name)}</strong>`;

    document.getElementById('form-manage-assignment')?.scrollIntoView({ behavior: 'smooth' });
};

/**
 * Simpan Data Penugasan Pegawai (Cloudflare D1)
 */
window.saveAssignmentForm = async function() {
    const id = document.getElementById('assign-form-id')?.value;
    const gtkId = document.getElementById('assign-form-gtk')?.value;
    const groupId = document.getElementById('assign-form-group')?.value;
    const role = document.getElementById('assign-form-role')?.value.trim();
    const scope = document.getElementById('assign-form-scope')?.value.trim();
    const isAssistant = document.getElementById('assign-form-is-assistant')?.checked;

    if (!gtkId || !groupId || !role) {
        if (window.showToast) window.showToast('Peringatan', 'Harap pilih Pegawai, Kelompok Tugas, dan tentukan Peran.', 'warning');
        return;
    }

    const selectedGtk = allGtkList.find(g => String(g.id) === String(gtkId));
    const empName = selectedGtk?.name || '';
    const empNip = selectedGtk?.nip || null;
    const empNik = selectedGtk?.nik || null;
    const userUid = selectedGtk?.uid || selectedGtk?.user_uid || null;

    const btn = document.getElementById('btn-save-assignment');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Menyimpan...';
    }

    try {
        const payload = {
            action: 'upsert_assignment',
            id: id || undefined,
            gtk_id: gtkId,
            group_id: groupId,
            employee_name: empName,
            employee_nip: empNip,
            employee_nik: empNik,
            user_uid: userUid,
            peran_rincian: role,
            role_in_group: role,
            role_title: role,
            is_assistant: isAssistant ? 1 : 0,
            custom_task_scope: scope,
            status: 'active'
        };

        const res = typeof cfClient.manageEmployeeAgenda === 'function'
            ? await cfClient.manageEmployeeAgenda(payload)
            : await cfClient.manageEmployeeSk(payload);

        if (res && res.success) {
            if (window.showToast) window.showToast('Berhasil', 'Penugasan pegawai berhasil disimpan ke database D1.', 'success');
            window.resetAssignmentForm();
            if (typeof window.toggleAssignmentForm === 'function') window.toggleAssignmentForm(false);
            await refreshManageData();
        } else {
            throw new Error(res?.error || 'Gagal menyimpan penugasan');
        }
    } catch (e) {
        console.error('[saveAssignmentForm] Error:', e);
        if (window.showToast) window.showToast('Gagal', e.message || 'Gagal menyimpan penugasan.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-check mr-1.5"></i> <span>Simpan</span>';
        }
    }
};

/**
 * Hapus Penugasan Pegawai
 */
window.deleteAssignmentItem = async function(id, empName, groupName) {
    const ok = await showConfirmModal(
        `Hapus penugasan tugas '${escapeHTML(groupName || 'Tugas')}' untuk '${escapeHTML(empName || 'Pegawai')}'?`,
        'Hapus Penugasan',
        'danger'
    );
    if (!ok) return;

    try {
        const payload = { action: 'delete_assignment', id };
        const res = typeof cfClient.manageEmployeeAgenda === 'function'
            ? await cfClient.manageEmployeeAgenda(payload)
            : await cfClient.manageEmployeeSk(payload);

        if (res && res.success) {
            if (window.showToast) window.showToast('Berhasil', 'Penugasan berhasil dihapus.', 'success');
            await refreshManageData();
        } else {
            throw new Error(res?.error || 'Gagal menghapus penugasan');
        }
    } catch (e) {
        console.error('[deleteAssignmentItem] Error:', e);
        if (window.showToast) window.showToast('Gagal', e.message || 'Gagal menghapus penugasan.', 'error');
    }
};

// -------------------------------------------------------------------------
// Bagian 12.2: Manajemen Kelompok Tugas (Task Groups)
// -------------------------------------------------------------------------

/**
 * Render Tabel Kelompok Tugas
 */
function renderManageGroupsTable() {
    const tbody = document.getElementById('table-manage-groups-body');
    const labelCount = document.getElementById('label-group-count');
    if (!tbody) return;

    const groups = masterSkData?.groups || [];
    const items = masterSkData?.items || [];

    if (labelCount) {
        labelCount.textContent = `${groups.length} Kelompok`;
    }

    if (groups.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center py-8 text-slate-400 italic">
                    Belum ada kelompok tugas terdaftar.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = groups.map(g => {
        const itemCount = items.filter(it => String(it.group_id) === String(g.id)).length;
        const code = g.kode_kelompok || g.group_code || '-';
        const name = g.nama_kelompok || g.group_name || '-';
        const order = g.urutan !== undefined ? g.urutan : (g.sort_order || 0);

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                <td class="py-2.5 px-3 text-center font-bold text-slate-400">
                    ${order}
                </td>
                <td class="py-2.5 px-3 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                    ${escapeHTML(code)}
                </td>
                <td class="py-2.5 px-3 font-semibold text-slate-800 dark:text-white">
                    ${escapeHTML(name)}
                </td>
                <td class="py-2.5 px-3 text-center">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        ${itemCount} Butir
                    </span>
                </td>
                <td class="py-2.5 px-3 text-right whitespace-nowrap">
                    <button type="button" onclick="window.editGroupItem('${escapeHTML(g.id)}')" class="w-7 h-7 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-all inline-flex items-center justify-center mr-1" title="Ubah Kelompok">
                        <i class="fa-solid fa-pen text-xs"></i>
                    </button>
                    <button type="button" onclick="window.deleteGroupItem('${escapeHTML(g.id)}', '${escapeHTML(name)}')" class="w-7 h-7 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-all inline-flex items-center justify-center" title="Hapus Kelompok">
                        <i class="fa-solid fa-trash-can text-xs"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Reset Formulir Kelompok Tugas
 */
window.resetGroupForm = function() {
    const form = document.getElementById('form-manage-group');
    if (form) form.reset();
    const idEl = document.getElementById('group-form-id');
    if (idEl) idEl.value = '';
    const heading = document.getElementById('group-form-heading');
    if (heading) heading.innerHTML = '<i class="fa-solid fa-folder-plus text-indigo-500"></i> Form Tambah / Ubah Kelompok Tugas';
};

/**
 * Edit Kelompok Tugas
 */
window.editGroupItem = function(id) {
    const groups = masterSkData?.groups || [];
    const item = groups.find(g => String(g.id) === String(id));
    if (!item) return;

    // Buka formulir jika sedang tertutup (collapsible)
    if (typeof window.toggleGroupForm === 'function') {
        window.toggleGroupForm(true);
    }

    document.getElementById('group-form-id').value = item.id;
    document.getElementById('group-form-code').value = item.kode_kelompok || item.group_code || '';
    document.getElementById('group-form-name').value = item.nama_kelompok || item.group_name || '';
    document.getElementById('group-form-order').value = item.urutan !== undefined ? item.urutan : (item.sort_order || 1);

    const heading = document.getElementById('group-form-heading');
    if (heading) heading.innerHTML = `<i class="fa-solid fa-folder-pen text-amber-500"></i> Ubah Kelompok: <strong>${escapeHTML(item.nama_kelompok || item.group_name)}</strong>`;

    document.getElementById('form-manage-group')?.scrollIntoView({ behavior: 'smooth' });
};

/**
 * Simpan Data Kelompok Tugas
 */
window.saveGroupForm = async function() {
    const id = document.getElementById('group-form-id')?.value;
    const code = document.getElementById('group-form-code')?.value.trim();
    const name = document.getElementById('group-form-name')?.value.trim();
    const order = parseInt(document.getElementById('group-form-order')?.value || '1', 10);

    if (!code || !name) {
        if (window.showToast) window.showToast('Peringatan', 'Kode kelompok dan nama kelompok wajib diisi.', 'warning');
        return;
    }

    const btn = document.getElementById('btn-save-group');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Menyimpan...';
    }

    try {
        const payload = {
            action: 'upsert_group',
            id: id || undefined,
            kode_kelompok: code,
            group_code: code,
            nama_kelompok: name,
            group_name: name,
            urutan: order,
            sort_order: order
        };

        const res = typeof cfClient.manageEmployeeAgenda === 'function'
            ? await cfClient.manageEmployeeAgenda(payload)
            : await cfClient.manageEmployeeSk(payload);

        if (res && res.success) {
            if (window.showToast) window.showToast('Berhasil', 'Kelompok tugas berhasil disimpan.', 'success');
            window.resetGroupForm();
            if (typeof window.toggleGroupForm === 'function') window.toggleGroupForm(false);
            await refreshManageData();
        } else {
            throw new Error(res?.error || 'Gagal menyimpan kelompok tugas');
        }
    } catch (e) {
        console.error('[saveGroupForm] Error:', e);
        if (window.showToast) window.showToast('Gagal', e.message || 'Gagal menyimpan kelompok tugas.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-save mr-1.5"></i> <span>Simpan</span>';
        }
    }
};

/**
 * Hapus Kelompok Tugas
 */
window.deleteGroupItem = async function(id, groupName) {
    const ok = await showConfirmModal(
        `Hapus kelompok tugas '${escapeHTML(groupName)}'? Perhatian: Seluruh butir rincian tugas dan penugasan staf pada kelompok ini akan ikut dihapus.`,
        'Hapus Kelompok Tugas',
        'danger'
    );
    if (!ok) return;

    try {
        const payload = { action: 'delete_group', id };
        const res = typeof cfClient.manageEmployeeAgenda === 'function'
            ? await cfClient.manageEmployeeAgenda(payload)
            : await cfClient.manageEmployeeSk(payload);

        if (res && res.success) {
            if (window.showToast) window.showToast('Berhasil', 'Kelompok tugas dan data terkait berhasil dihapus.', 'success');
            await refreshManageData();
        } else {
            throw new Error(res?.error || 'Gagal menghapus kelompok tugas');
        }
    } catch (e) {
        console.error('[deleteGroupItem] Error:', e);
        if (window.showToast) window.showToast('Gagal', e.message || 'Gagal menghapus kelompok tugas.', 'error');
    }
};

// -------------------------------------------------------------------------
// Bagian 12.3: Manajemen Butir Rincian Tugas (Task Items)
// -------------------------------------------------------------------------

/**
 * Render Tabel Butir Rincian Tugas
 */
function renderManageItemsTable() {
    const tbody = document.getElementById('table-manage-items-body');
    const labelCount = document.getElementById('label-item-count');
    if (!tbody) return;

    const items = masterSkData?.items || [];
    const groups = masterSkData?.groups || [];
    const filterGroupId = document.getElementById('filter-item-by-group')?.value || 'all';

    let displayItems = items;
    if (filterGroupId && filterGroupId !== 'all') {
        displayItems = items.filter(it => String(it.group_id) === String(filterGroupId));
    }

    if (labelCount) labelCount.textContent = `${displayItems.length} Butir`;

    if (displayItems.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center py-8 text-slate-400 italic">
                    Tidak ada butir rincian tugas untuk filter yang dipilih.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = displayItems.map(it => {
        const groupObj = groups.find(g => String(g.id) === String(it.group_id));
        const groupName = groupObj ? (groupObj.nama_kelompok || groupObj.group_name) : '-';
        const code = it.kode_butir || it.task_code || it.item_code || '-';
        const desc = it.uraian_tugas || it.task_name || it.item_name || '-';
        const order = it.urutan !== undefined ? it.urutan : (it.sort_order || 0);

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                <td class="py-2.5 px-3 text-center font-bold text-slate-400">
                    ${order}
                </td>
                <td class="py-2.5 px-3 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                    ${escapeHTML(code)}
                </td>
                <td class="py-2.5 px-3 text-slate-500 text-xs">
                    ${escapeHTML(groupName)}
                </td>
                <td class="py-2.5 px-3 font-medium text-slate-800 dark:text-slate-200 leading-relaxed">
                    ${escapeHTML(desc)}
                </td>
                <td class="py-2.5 px-3 text-right whitespace-nowrap">
                    <button type="button" onclick="window.editTaskItem('${escapeHTML(it.id)}')" class="w-7 h-7 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-all inline-flex items-center justify-center mr-1" title="Ubah Butir Tugas">
                        <i class="fa-solid fa-pen text-xs"></i>
                    </button>
                    <button type="button" onclick="window.deleteTaskItem('${escapeHTML(it.id)}', '${escapeHTML(code)}')" class="w-7 h-7 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-all inline-flex items-center justify-center" title="Hapus Butir Tugas">
                        <i class="fa-solid fa-trash-can text-xs"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Filter Per Kelompok pada Tabel Butir Tugas
 */
window.onFilterItemGroupChange = function() {
    renderManageItemsTable();
};

/**
 * Reset Formulir Butir Tugas
 */
window.resetTaskItemForm = function() {
    const form = document.getElementById('form-manage-item');
    if (form) form.reset();
    const idEl = document.getElementById('item-form-id');
    if (idEl) idEl.value = '';
    const heading = document.getElementById('item-form-heading');
    if (heading) heading.innerHTML = '<i class="fa-solid fa-file-circle-plus text-indigo-500"></i> Form Tambah / Ubah Butir Rincian Tugas';
};

/**
 * Edit Butir Tugas
 */
window.editTaskItem = function(id) {
    const items = masterSkData?.items || [];
    const item = items.find(it => String(it.id) === String(id));
    if (!item) return;

    // Buka formulir jika sedang tertutup (collapsible)
    if (typeof window.toggleItemForm === 'function') {
        window.toggleItemForm(true);
    }

    document.getElementById('item-form-id').value = item.id;
    document.getElementById('item-form-group').value = item.group_id || '';
    document.getElementById('item-form-code').value = item.kode_butir || item.task_code || item.item_code || '';
    document.getElementById('item-form-desc').value = item.uraian_tugas || item.task_name || item.item_name || '';
    document.getElementById('item-form-order').value = item.urutan !== undefined ? item.urutan : (item.sort_order || 1);

    const heading = document.getElementById('item-form-heading');
    if (heading) heading.innerHTML = `<i class="fa-solid fa-file-pen text-amber-500"></i> Ubah Butir: <strong>${escapeHTML(item.kode_butir || item.task_code)}</strong>`;

    document.getElementById('form-manage-item')?.scrollIntoView({ behavior: 'smooth' });
};

/**
 * Simpan Data Butir Rincian Tugas
 */
window.saveTaskItemForm = async function() {
    const id = document.getElementById('item-form-id')?.value;
    const groupId = document.getElementById('item-form-group')?.value;
    const code = document.getElementById('item-form-code')?.value.trim();
    const desc = document.getElementById('item-form-desc')?.value.trim();
    const order = parseInt(document.getElementById('item-form-order')?.value || '1', 10);

    if (!groupId || !code || !desc) {
        if (window.showToast) window.showToast('Peringatan', 'Kelompok tugas, kode butir, dan uraian tugas wajib diisi.', 'warning');
        return;
    }

    const btn = document.getElementById('btn-save-item');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Menyimpan...';
    }

    try {
        const payload = {
            action: 'upsert_task_item',
            id: id || undefined,
            group_id: groupId,
            kode_butir: code,
            task_code: code,
            item_code: code,
            uraian_tugas: desc,
            task_name: desc,
            item_name: desc,
            urutan: order,
            sort_order: order
        };

        const res = typeof cfClient.manageEmployeeAgenda === 'function'
            ? await cfClient.manageEmployeeAgenda(payload)
            : await cfClient.manageEmployeeSk(payload);

        if (res && res.success) {
            if (window.showToast) window.showToast('Berhasil', 'Butir rincian tugas berhasil disimpan.', 'success');
            window.resetTaskItemForm();
            if (typeof window.toggleItemForm === 'function') window.toggleItemForm(false);
            await refreshManageData();
        } else {
            throw new Error(res?.error || 'Gagal menyimpan butir tugas');
        }
    } catch (e) {
        console.error('[saveTaskItemForm] Error:', e);
        if (window.showToast) window.showToast('Gagal', e.message || 'Gagal menyimpan butir tugas.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-save mr-1.5"></i> <span>Simpan Butir Tugas</span>';
        }
    }
};

/**
 * Hapus Butir Rincian Tugas
 */
window.deleteTaskItem = async function(id, code) {
    const ok = await showConfirmModal(
        `Hapus butir rincian tugas '${escapeHTML(code)}'?`,
        'Hapus Butir Tugas',
        'danger'
    );
    if (!ok) return;

    try {
        const payload = { action: 'delete_task_item', id };
        const res = typeof cfClient.manageEmployeeAgenda === 'function'
            ? await cfClient.manageEmployeeAgenda(payload)
            : await cfClient.manageEmployeeSk(payload);

        if (res && res.success) {
            if (window.showToast) window.showToast('Berhasil', 'Butir rincian tugas berhasil dihapus.', 'success');
            await refreshManageData();
        } else {
            throw new Error(res?.error || 'Gagal menghapus butir tugas');
        }
    } catch (e) {
        console.error('[deleteTaskItem] Error:', e);
        if (window.showToast) window.showToast('Gagal', e.message || 'Gagal menghapus butir tugas.', 'error');
    }
};

/**
 * Render Tabel Butir Tugas Kepala Sekolah (Permendikdasmen 23/2026 - 2 Kolom: Tugas Pokok & Uraian)
 */
function renderManagePrincipalGroupsTable() {
    const tbody = document.getElementById('table-manage-principal-groups-body');
    const labelCount = document.getElementById('label-principal-group-count');
    if (!tbody) return;

    const allGroups = (typeof masterSkData !== 'undefined' && masterSkData?.groups) ? masterSkData.groups : [];
    let principalGroups = allGroups.filter(isPrincipalGroup);

    // Prioritaskan data yang tersimpan di basis data D1
    const displayList = principalGroups.length > 0 ? principalGroups : (typeof DEFAULT_PRINCIPAL_GROUPS !== 'undefined' ? DEFAULT_PRINCIPAL_GROUPS : []);

    if (labelCount) {
        labelCount.textContent = `${displayList.length} Butir (D1 Database)`;
    }

    if (displayList.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center py-8 text-slate-400 italic">
                    Belum ada butir tugas Kepala Sekolah di basis data. Klik tombol "Standar Permendikdasmen" di atas untuk menyimpan butir standar ke basis data.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = displayList.map((g, idx) => {
        const code = g.kode_kelompok || g.group_code || '-';
        const { title, desc } = parsePrincipalGroupFields(g);
        const name = title || g.nama_kelompok || g.group_name || '-';
        const description = desc || '-';
        const order = g.urutan !== undefined ? g.urutan : (g.sort_order || (idx + 1));
        const rowId = g.id || `ks-group-${idx + 1}`;

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                <td class="py-2.5 px-3 text-center font-bold text-slate-400">
                    ${order}
                </td>
                <td class="py-2.5 px-3 font-mono font-bold text-amber-600 dark:text-amber-400">
                    ${escapeHTML(code)}
                </td>
                <td class="py-2.5 px-3 font-semibold text-slate-800 dark:text-white">
                    ${escapeHTML(name)}
                </td>
                <td class="py-2.5 px-3 text-slate-600 dark:text-slate-300 text-xs leading-relaxed">
                    ${escapeHTML(description)}
                </td>
                <td class="py-2.5 px-3 text-right whitespace-nowrap">
                    <button type="button" onclick="window.editPrincipalGroupItem('${escapeHTML(rowId)}')" class="w-7 h-7 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-all inline-flex items-center justify-center mr-1" title="Ubah Butir di Basis Data">
                        <i class="fa-solid fa-pen text-xs"></i>
                    </button>
                    <button type="button" onclick="window.deletePrincipalGroupItem('${escapeHTML(rowId)}', '${escapeHTML(name)}')" class="w-7 h-7 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition-all inline-flex items-center justify-center" title="Hapus Butir dari Basis Data">
                        <i class="fa-solid fa-trash-can text-xs"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Toggle Form Butir Tugas Kepala Sekolah
 */
window.togglePrincipalGroupForm = function(force) {
    const container = document.getElementById('container-form-principal-group');
    if (!container) return;
    const isHidden = container.classList.contains('hidden');
    const show = (typeof force === 'boolean') ? force : isHidden;
    if (show) {
        container.classList.remove('hidden');
    } else {
        container.classList.add('hidden');
    }
    const icon = document.getElementById('icon-toggle-principal-group-form');
    const text = document.getElementById('text-toggle-principal-group-form');
    const btn = document.getElementById('btn-toggle-principal-group-form');
    if (show) {
        if (icon) icon.className = 'fa-solid fa-times-circle text-xs';
        if (text) text.textContent = 'Tutup Form';
        if (btn) {
            btn.classList.remove('bg-amber-600', 'hover:bg-amber-700');
            btn.classList.add('bg-slate-600', 'hover:bg-slate-700');
        }
    } else {
        if (icon) icon.className = 'fa-solid fa-plus-circle text-xs';
        if (text) text.textContent = 'Tambah Butir';
        if (btn) {
            btn.classList.add('bg-amber-600', 'hover:bg-amber-700');
            btn.classList.remove('bg-slate-600', 'hover:bg-slate-700');
        }
    }
};

/**
 * Reset Formulir Butir Tugas Kepala Sekolah
 */
window.resetPrincipalGroupForm = function() {
    const form = document.getElementById('form-manage-principal-group');
    if (form) form.reset();
    const idEl = document.getElementById('principal-group-form-id');
    if (idEl) idEl.value = '';
    const descEl = document.getElementById('principal-group-form-desc');
    if (descEl) descEl.value = '';
    const orderEl = document.getElementById('principal-group-form-order');
    if (orderEl) {
        const principalGroups = (masterSkData?.groups || []).filter(isPrincipalGroup);
        orderEl.value = String(principalGroups.length + 1);
    }
    const heading = document.getElementById('principal-group-form-heading');
    if (heading) heading.innerHTML = '<i class="fa-solid fa-folder-plus text-amber-500"></i> Form Tambah / Ubah Butir Tugas Kepala Sekolah';
};

/**
 * Edit Butir Tugas Kepala Sekolah
 */
window.editPrincipalGroupItem = function(id) {
    const allGroups = (typeof masterSkData !== 'undefined' && masterSkData?.groups) ? masterSkData.groups : [];
    let group = allGroups.find(g => String(g.id) === String(id));
    if (!group) {
        group = DEFAULT_PRINCIPAL_GROUPS.find((g, idx) => (g.id === id || `ks-group-${idx + 1}` === id));
    }
    if (!group) return;

    window.togglePrincipalGroupForm(true);

    const idInput = document.getElementById('principal-group-form-id');
    if (idInput) {
        idInput.value = group.id || id || '';
    }
    const codeInput = document.getElementById('principal-group-form-code');
    if (codeInput) codeInput.value = group.kode_kelompok || group.group_code || '';

    const { title, desc } = parsePrincipalGroupFields(group);
    const nameInput = document.getElementById('principal-group-form-name');
    if (nameInput) nameInput.value = title || group.nama_kelompok || group.group_name || '';
    const descInput = document.getElementById('principal-group-form-desc');
    if (descInput) descInput.value = desc || '';

    const orderInput = document.getElementById('principal-group-form-order');
    if (orderInput) orderInput.value = group.urutan !== undefined ? group.urutan : (group.sort_order || 1);

    const heading = document.getElementById('principal-group-form-heading');
    if (heading) {
        heading.innerHTML = `<i class="fa-solid fa-folder-open text-amber-500"></i> Ubah Butir KS: <strong>${escapeHTML(group.kode_kelompok || group.group_code || '')}</strong>`;
    }

    document.getElementById('form-manage-principal-group')?.scrollIntoView({ behavior: 'smooth' });
};
window.editPrincipalGroup = window.editPrincipalGroupItem;

/**
 * Simpan Data Butir Tugas Kepala Sekolah ke Basis Data D1 (is_principal = 1)
 */
window.savePrincipalGroupForm = async function() {
    const id = document.getElementById('principal-group-form-id')?.value;
    const code = document.getElementById('principal-group-form-code')?.value.trim();
    const name = document.getElementById('principal-group-form-name')?.value.trim();
    const desc = document.getElementById('principal-group-form-desc')?.value.trim();
    const order = parseInt(document.getElementById('principal-group-form-order')?.value || '1', 10);

    if (!code || !name) {
        if (window.showToast) window.showToast('Peringatan', 'Kode butir dan Tugas Pokok (judul singkat) Kepala Sekolah wajib diisi.', 'warning');
        return;
    }

    const btn = document.getElementById('btn-save-principal-group');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Menyimpan...';
    }

    try {
        const payload = {
            action: 'upsert_group',
            id: id || undefined,
            kode_kelompok: code,
            group_code: code,
            nama_kelompok: name,
            group_name: name,
            uraian_tugas: desc || '',
            urutan: order,
            sort_order: order,
            is_principal: 1
        };

        const res = typeof cfClient.manageEmployeeAgenda === 'function'
            ? await cfClient.manageEmployeeAgenda(payload)
            : await cfClient.manageEmployeeSk(payload);

        if (res && res.success) {
            if (window.showToast) window.showToast('Berhasil', 'Butir tugas Kepala Sekolah berhasil disimpan di basis data.', 'success');
            window.resetPrincipalGroupForm();
            window.togglePrincipalGroupForm(false);
            if (typeof refreshManageData === 'function') await refreshManageData();
        } else {
            throw new Error(res?.error || 'Gagal menyimpan butir tugas Kepala Sekolah');
        }
    } catch (e) {
        console.error('[savePrincipalGroupForm] Error:', e);
        if (window.showToast) window.showToast('Gagal', e.message || 'Gagal menyimpan butir tugas Kepala Sekolah.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-save mr-1.5"></i> <span>Simpan Butir Tugas Kepsek</span>';
        }
    }
};

/**
 * Hapus Butir Tugas Kepala Sekolah dari Basis Data D1
 */
window.deletePrincipalGroupItem = async function(id, name) {
    const ok = await showConfirmModal(
        `Hapus butir tugas Kepala Sekolah '${escapeHTML(name)}' dari basis data?`,
        'Hapus Butir Tugas Kepala Sekolah',
        'danger'
    );
    if (!ok) return;

    try {
        const payload = { action: 'delete_group', id };
        const res = typeof cfClient.manageEmployeeAgenda === 'function'
            ? await cfClient.manageEmployeeAgenda(payload)
            : await cfClient.manageEmployeeSk(payload);

        if (res && res.success) {
            if (window.showToast) window.showToast('Berhasil', 'Butir tugas Kepala Sekolah berhasil dihapus dari basis data.', 'success');
            if (typeof refreshManageData === 'function') await refreshManageData();
        } else {
            throw new Error(res?.error || 'Gagal menghapus butir tugas Kepala Sekolah');
        }
    } catch (e) {
        console.error('[deletePrincipalGroupItem] Error:', e);
        if (window.showToast) window.showToast('Gagal', e.message || 'Gagal menghapus butir tugas Kepala Sekolah.', 'error');
    }
};
window.deletePrincipalGroup = window.deletePrincipalGroupItem;

/**
 * Sinkronisasi Otomatis 6 Butir Standar Permendikdasmen No. 23/2026 ke Basis Data D1
 */
window.seedDefaultPrincipalGroups = async function() {
    const ok = await showConfirmModal(
        'Muat dan simpan butir standar penugasan Kepala Sekolah sesuai Permendikdasmen 23/2026 ke basis data D1?',
        'Standar Permendikdasmen 23/2026',
        'info'
    );
    if (!ok) return;

    const btn = document.getElementById('btn-seed-principal-groups');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Memuat...';
    }

    try {
        let savedCount = 0;
        for (const item of DEFAULT_PRINCIPAL_GROUPS) {
            const payload = {
                action: 'upsert_group',
                id: item.id,
                kode_kelompok: item.kode_kelompok,
                group_code: item.kode_kelompok,
                nama_kelompok: item.nama_kelompok,
                group_name: item.nama_kelompok,
                uraian_tugas: item.uraian_tugas || '',
                urutan: item.urutan,
                sort_order: item.urutan,
                is_principal: 1
            };
            const res = typeof cfClient.manageEmployeeAgenda === 'function'
                ? await cfClient.manageEmployeeAgenda(payload)
                : await cfClient.manageEmployeeSk(payload);
            if (res && res.success) savedCount++;
        }

        if (window.showToast) {
            window.showToast('Berhasil', `${savedCount} butir tugas pokok Kepala Sekolah berhasil disimpan di basis data D1.`, 'success');
        }
        if (typeof refreshManageData === 'function') await refreshManageData();
    } catch (e) {
        console.error('[seedDefaultPrincipalGroups] Error:', e);
        if (window.showToast) window.showToast('Gagal', e.message || 'Gagal memuat standar butir Kepala Sekolah ke basis data.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles text-amber-500 mr-1.5"></i> <span>Standar Permendikdasmen</span>';
        }
    }
};

// =========================================================================
// BAGIAN 12.5: PENGATURAN HAK AKSES VIP TENDIK (SUPER ADMIN ONLY)
// =========================================================================

/**
 * Helper untuk menentukan apakah entri GTK adalah Tenaga Kependidikan (Tendik).
 * Murni memfilter staf/tendik dan menyaring keluar guru/tenaga pendidik.
 */
export function isTendikGtk(g) {
    if (!g) return false;
    const gId = String(g.id || '');
    const gNip = (g.nip && String(g.nip).trim() !== '-' && String(g.nip).trim() !== '') ? String(g.nip).trim() : '';
    const gName = (g.name || '').trim().toLowerCase();

    // 1. Prioritas Utama: Terdaftar memiliki penugasan SK Tendik aktif
    if (Array.isArray(allAssignmentsList) && allAssignmentsList.length > 0) {
        const hasAssignment = allAssignmentsList.some(a => {
            if (a.status && a.status !== 'active') return false;
            const matchId = a.gtk_id && String(a.gtk_id) === gId;
            const matchNip = a.employee_nip && gNip && String(a.employee_nip).trim() === gNip;
            const matchName = a.employee_name && gName && a.employee_name.trim().toLowerCase() === gName;
            return matchId || matchNip || matchName;
        });
        if (hasAssignment) return true;
    }

    const jenisPtk = String(g.jenis_ptk || '').toLowerCase();
    const role = String(g.role || '').toLowerCase();
    const jabatan = String(g.jabatan || '').toLowerCase();

    // 2. Eksklusif Guru / Tenaga Pendidik (JANGAN munculkan di VIP Tendik)
    if (jenisPtk.includes('guru') || jenisPtk.includes('pendidik') || role === 'guru_bk') {
        return false;
    }

    // 3. Indikator peran atau jabatan Tenaga Kependidikan
    return (
        jenisPtk.includes('tenaga kependidikan') ||
        jenisPtk.includes('kependidikan') ||
        jenisPtk.includes('tendik') ||
        jenisPtk.includes('tata usaha') ||
        jenisPtk.includes('administrasi') ||
        jenisPtk.includes('keamanan') ||
        jenisPtk.includes('satpam') ||
        jenisPtk.includes('kebersihan') ||
        jenisPtk.includes('laboran') ||
        jenisPtk.includes('laboratorium') ||
        jenisPtk.includes('pustakawan') ||
        jenisPtk.includes('perpustakaan') ||
        jenisPtk.includes('teknisi') ||
        jenisPtk.includes('operator') ||
        jenisPtk.includes('sopir') ||
        jenisPtk.includes('driver') ||
        jenisPtk.includes('pengemudi') ||
        jenisPtk.includes('penjaga') ||
        jenisPtk.includes('pramubakti') ||
        jenisPtk.includes('pesuruh') ||
        ['staff', 'tendik', 'tenaga_kependidikan', 'pegawai', 'keamanan'].includes(role) ||
        jabatan.includes('tata usaha') ||
        jabatan.includes('laboran') ||
        jabatan.includes('pustakawan')
    );
}
window.isTendikGtk = isTendikGtk;

/**
 * Mengambil daftar seluruh Tenaga Kependidikan (Tendik) aktif dari master GTK
 */
export function getTendikGtkList() {
    return (allGtkList || []).filter(isTendikGtk);
}
window.getTendikGtkList = getTendikGtkList;

/**
 * Memuat data konfigurasi hak akses VIP dari Cloudflare D1
 */
window.loadVipSettingsData = async function() {
    const tbody = document.getElementById('table-manage-vip-body');
    const toggleAll = document.getElementById('toggle-vip-all-tendik');
    const labelStatus = document.getElementById('label-vip-all-tendik-status');

    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="text-center py-8 text-slate-400 italic">
                    <i class="fa-solid fa-spinner fa-spin text-xl mb-2 text-amber-500 block"></i>
                    Memuat data konfigurasi VIP...
                </td>
            </tr>
        `;
    }

    try {
        // Pastikan daftar master GTK terisi
        if (!allGtkList || allGtkList.length === 0) {
            try {
                const gtkRes = await cfClient.getGtk();
                allGtkList = Array.isArray(gtkRes) ? gtkRes : (gtkRes?.data || []);
            } catch (_) {}
        }

        // Pastikan daftar penugasan tendik terisi untuk cross-reference akurat
        if (!allAssignmentsList || allAssignmentsList.length === 0) {
            try {
                const asgRes = await cfClient.getEmployeeAssignments({});
                allAssignmentsList = Array.isArray(asgRes) ? asgRes : (asgRes?.data || []);
            } catch (_) {}
        }

        const res = await cfClient.getEmployeeVipSettings();
        if (res && res.config) {
            _vipConfig = {
                all_tendik: res.config.all_tendik === true,
                allowed_gtk_ids: Array.isArray(res.config.allowed_gtk_ids) ? res.config.allowed_gtk_ids.map(String) : [],
                allowed_uids: Array.isArray(res.config.allowed_uids) ? res.config.allowed_uids.map(String) : []
            };
        }

        if (toggleAll) toggleAll.checked = _vipConfig.all_tendik === true;
        if (labelStatus) {
            labelStatus.textContent = _vipConfig.all_tendik ? 'Aktif untuk Semua' : 'Nonaktif';
            labelStatus.className = `ml-2.5 text-xs font-bold select-none ${_vipConfig.all_tendik ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'}`;
        }

        updateManageBadges();
        window.renderVipEmployeesList();
    } catch (err) {
        console.error('[loadVipSettingsData] Error:', err);
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" class="text-center py-8 text-rose-500 text-xs">
                        <i class="fa-solid fa-triangle-exclamation text-xl mb-1 block"></i>
                        Gagal memuat pengaturan VIP: ${escapeHTML(err.message || 'Terjadi kesalahan server')}
                    </td>
                </tr>
            `;
        }
    }
};

/**
 * Filter dan Render Daftar Tendik pada Tabel Tab VIP
 */
window.renderVipEmployeesList = function() {
    const tbody = document.getElementById('table-manage-vip-body');
    const labelSelected = document.getElementById('label-vip-selected-count');
    if (!tbody) return;

    // Filter HANYA Tenaga Kependidikan (Tendik), guru tidak dimunculkan di tab ini
    const tendikPopulation = getTendikGtkList();
    let staffList = [...tendikPopulation];

    // Filter berdasarkan query pencarian
    const q = (_vipSearchQuery || '').toLowerCase().trim();
    if (q) {
        staffList = staffList.filter(g => {
            const name = (g.name || '').toLowerCase();
            const nip = (g.nip || '').toLowerCase();
            const role = (g.role || g.jabatan || g.jenis_ptk || '').toLowerCase();
            return name.includes(q) || nip.includes(q) || role.includes(q);
        });
    }

    // Urutkan alfabetis
    staffList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    const tendikIds = new Set(tendikPopulation.map(g => String(g.id)));
    const selectedTendikCount = (_vipConfig.allowed_gtk_ids || []).filter(id => tendikIds.has(String(id))).length;

    if (labelSelected) {
        if (_vipConfig.all_tendik) {
            labelSelected.textContent = `Akses Global Aktif (${tendikPopulation.length} Tendik)`;
            labelSelected.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-700';
        } else {
            labelSelected.textContent = `${selectedTendikCount} dari ${tendikPopulation.length} Tendik Dipilih`;
            labelSelected.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/40';
        }
    }

    if (staffList.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="text-center py-8 text-slate-400 italic">
                    <i class="fa-solid fa-user-slash text-2xl mb-2 text-slate-300 block"></i>
                    ${q ? `Tidak ada pegawai tendik yang sesuai dengan kata kunci "${escapeHTML(q)}".` : 'Tidak ada data pegawai tendik yang terdaftar.'}
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = staffList.map(g => {
        const gid = String(g.id);
        const isChecked = _vipConfig.all_tendik || _vipConfig.allowed_gtk_ids.includes(gid);
        const nipStr = (g.nip && String(g.nip).trim() !== '-' && String(g.nip).trim() !== '') ? `NIP. ${escapeHTML(g.nip)}` : 'Non-NIP';
        const roleStr = g.jenis_ptk || g.jabatan || g.role || 'Tenaga Kependidikan';

        const statusBadge = isChecked
            ? `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                 <i class="fa-solid fa-crown text-[9px] text-amber-500"></i> VIP Aktif
               </span>`
            : `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                 Standar
               </span>`;

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                <td class="py-2.5 px-3 text-center">
                    <input type="checkbox"
                           ${isChecked ? 'checked' : ''}
                           ${_vipConfig.all_tendik ? 'disabled title="Akses aktif secara global"' : ''}
                           onchange="window.toggleVipEmployeeSelection('${escapeHTML(gid)}', this.checked)"
                           class="w-4 h-4 text-amber-600 rounded border-slate-300 focus:ring-amber-500 cursor-pointer disabled:opacity-50">
                </td>
                <td class="py-2.5 px-3">
                    <div class="font-bold text-slate-800 dark:text-white text-xs">${escapeHTML(g.name || 'Tanpa Nama')}</div>
                    <div class="text-[10px] text-slate-400 font-mono mt-0.5">${nipStr}</div>
                </td>
                <td class="py-2.5 px-3 text-slate-600 dark:text-slate-300 text-xs">
                    ${escapeHTML(roleStr)}
                </td>
                <td class="py-2.5 px-3 text-center whitespace-nowrap">
                    ${statusBadge}
                </td>
            </tr>
        `;
    }).join('');
};

/**
 * Toggle Switch Akses Global Seluruh Tendik
 */
window.toggleVipAllTendik = function(isChecked) {
    _vipConfig.all_tendik = Boolean(isChecked);
    const labelStatus = document.getElementById('label-vip-all-tendik-status');
    if (labelStatus) {
        labelStatus.textContent = _vipConfig.all_tendik ? 'Aktif untuk Semua' : 'Nonaktif';
        labelStatus.className = `ml-2.5 text-xs font-bold select-none ${_vipConfig.all_tendik ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'}`;
    }
    updateManageBadges();
    window.renderVipEmployeesList();
};

/**
 * Toggle Centang Akses VIP Perorangan
 */
window.toggleVipEmployeeSelection = function(gtkId, isChecked) {
    if (!gtkId) return;
    const sId = String(gtkId);
    let list = Array.isArray(_vipConfig.allowed_gtk_ids) ? [..._vipConfig.allowed_gtk_ids] : [];

    if (isChecked) {
        if (!list.includes(sId)) list.push(sId);
    } else {
        list = list.filter(id => id !== sId);
    }

    _vipConfig.allowed_gtk_ids = list;
    updateManageBadges();
    window.renderVipEmployeesList();
};

/**
 * Pilih Semua atau Kosongkan Pilihan Tendik
 */
window.selectAllVipEmployees = function(selectAll = true) {
    if (_vipConfig.all_tendik) {
        if (window.showToast) window.showToast('Info', 'Akses global untuk seluruh tendik sedang aktif.', 'info');
        return;
    }

    const tendikPopulation = getTendikGtkList();
    const tendikIds = tendikPopulation.map(g => String(g.id)).filter(Boolean);

    if (selectAll) {
        _vipConfig.allowed_gtk_ids = Array.from(new Set([...(_vipConfig.allowed_gtk_ids || []), ...tendikIds]));
    } else {
        const tendikIdSet = new Set(tendikIds);
        _vipConfig.allowed_gtk_ids = (_vipConfig.allowed_gtk_ids || []).filter(id => !tendikIdSet.has(String(id)));
    }

    updateManageBadges();
    window.renderVipEmployeesList();
};

/**
 * Filter Input Pencarian Tendik
 */
window.filterVipEmployeesList = function() {
    const input = document.getElementById('input-search-vip');
    _vipSearchQuery = (input?.value || '').trim();
    window.renderVipEmployeesList();
};

/**
 * Menyimpan Konfigurasi Hak Akses VIP ke Cloudflare D1
 */
window.saveVipSettings = async function() {
    const btn = document.getElementById('btn-save-vip-settings');
    const btnTop = document.getElementById('btn-save-vip-settings-top');

    const setBusy = (isBusy) => {
        if (btn) {
            btn.disabled = isBusy;
            btn.innerHTML = isBusy
                ? '<i class="fa-solid fa-spinner fa-spin text-xs"></i> <span>Menyimpan...</span>'
                : '<i class="fa-solid fa-floppy-disk text-xs"></i> <span>Simpan Hak Akses VIP Tendik</span>';
        }
        if (btnTop) {
            btnTop.disabled = isBusy;
            btnTop.innerHTML = isBusy
                ? '<i class="fa-solid fa-spinner fa-spin text-xs"></i> <span>Menyimpan...</span>'
                : '<i class="fa-solid fa-floppy-disk text-xs"></i> <span>Simpan Pengaturan</span>';
        }
    };

    setBusy(true);
    try {
        const payload = {
            all_tendik: _vipConfig.all_tendik === true,
            allowed_gtk_ids: _vipConfig.allowed_gtk_ids || [],
            allowed_uids: _vipConfig.allowed_uids || []
        };

        const res = await cfClient.saveEmployeeVipSettings(payload);
        if (res && res.success) {
            if (window.showToast) {
                window.showToast('Berhasil', 'Pengaturan hak akses VIP Tendik berhasil disimpan.', 'success');
            }
            updateManageBadges();
        } else {
            throw new Error(res?.error || 'Gagal menyimpan pengaturan VIP');
        }
    } catch (e) {
        console.error('[saveVipSettings] Error:', e);
        if (window.showToast) {
            window.showToast('Gagal', e.message || 'Gagal menyimpan pengaturan VIP.', 'error');
        }
    } finally {
        setBusy(false);
    }
};


