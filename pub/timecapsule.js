import { SCHOOL_CONFIG } from '../js/school-config.js';
import { installWorkerFallback } from '../js/worker-fallback.mjs';

// This public page has its own Firebase app and does not import config.js.
installWorkerFallback({
    primaryUrl: "https://simas-demo-api.komangpurna1.workers.dev",
    gatewayUrl: "https://wwvtthoeknizglicrhor.supabase.co/functions/v1/worker-gateway"
});

// ==================== FIREBASE SDK v9 (Modular via CDN) ====================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
// 🔧 KONFIGURASI FIREBASE - ISI DENGAN DATA ANDA
// ============================================================
const firebaseConfig = {
    apiKey: "AIzaSyDphzPKM2poA6U6RyXu798j7_ITgxN07nI",
    authDomain: "smagesa.firebaseapp.com",
    projectId: "smagesa",
    storageBucket: "simas-demo-5ead3.firebasestorage.app",
    messagingSenderId: "246723731558",
    appId: "1:246723731558:web:073b3b2005997f45730da7"
};
// ============================================================

// Initialize Firebase
const app = initializeApp(firebaseConfig, 'timecapsule');
const db = getFirestore(app);
const auth = getAuth(app);
const CLOUDFLARE_WORKER_URL = "https://simas-demo-api.komangpurna1.workers.dev";
const EDIT_TOKEN_PREFIX = 'simas_timecapsule_edit_token';

async function callTimeCapsuleWorker(path, payload) {
    if (!auth.currentUser) await signInAnonymously(auth);
    const idToken = await auth.currentUser.getIdToken();
    const response = await fetch(`${CLOUDFLARE_WORKER_URL}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`,
            'X-Simas-Client': 'timecapsule-web-v1'
        },
        body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success === false) {
        const error = new Error(result.error || result.message || `Worker HTTP ${response.status}`);
        error.code = result.code || `worker/${response.status}`;
        throw error;
    }
    return result;
}

function getEditTokenKey(year, email) {
    return `${EDIT_TOKEN_PREFIX}:${year}:${String(email || '').trim().toLowerCase()}`;
}

// ==================== CUSTOM ALERT POPUP ====================
function showAlert(message, icon = '⚠️') {
    const overlay = document.getElementById('alertOverlay');
    const msgEl = document.getElementById('alertMessage');
    const iconEl = document.getElementById('alertIcon');
    iconEl.textContent = icon;
    msgEl.textContent = message;
    overlay.classList.add('show');
    document.getElementById('alertBtn').focus();
}

document.getElementById('alertBtn').addEventListener('click', () => {
    document.getElementById('alertOverlay').classList.remove('show');
});

document.getElementById('alertOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        e.currentTarget.classList.remove('show');
    }
});

// ==================== CUSTOM CONFIRM POPUP ====================
function showConfirm(message, onConfirm, icon = '🔄') {
    const overlay = document.getElementById('confirmOverlay');
    const msgEl = document.getElementById('confirmMessage');
    const iconEl = document.getElementById('confirmIcon');
    iconEl.textContent = icon;
    msgEl.textContent = message;
    overlay.classList.add('show');

    const btnYes = document.getElementById('btnConfirmYes');
    const btnCancel = document.getElementById('btnConfirmCancel');

    // Clear old listeners dengan clone
    const newBtnYes = btnYes.cloneNode(true);
    const newBtnCancel = btnCancel.cloneNode(true);
    btnYes.parentNode.replaceChild(newBtnYes, btnYes);
    btnCancel.parentNode.replaceChild(newBtnCancel, btnCancel);

    newBtnCancel.addEventListener('click', () => {
        overlay.classList.remove('show');
        // Reset state loading di form karena dibatalkan
        const loadingOverlay = document.getElementById('loadingOverlay');
        const btnSubmit = document.getElementById('btnSubmit');
        if (loadingOverlay) loadingOverlay.classList.remove('show');
        if (btnSubmit) btnSubmit.disabled = false;
    });

    newBtnYes.addEventListener('click', () => {
        overlay.classList.remove('show');
        onConfirm();
    });
}

// ==================== KONFIGURASI UPLOAD FOTO ====================
// ⚠️ GANTI URL INI setelah deploy Google Apps Script sebagai Web App
const GAS_WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbx16SVt60Y_T_00nhWG9BvfugNWZwXRXSqH0tVLosdArlaQpj8SogXgLWvVSOrH_glD6Q/exec';

// State untuk foto
let compressedFotoBase64 = null; // base64 tanpa prefix
let compressedFotoBlob = null;   // untuk preview
let fotoOriginalSize = 0;
let fotoCompressedSize = 0;
let fotoUploaded = false;        // flag apakah foto sudah berhasil upload
let uploadedFotoData = null;     // {fileId, url} dari GAS

// ==================== INITIALIZE DYNAMIC TEXT ====================
const currentYear = new Date().getFullYear();
let targetYear = currentYear + 5;
let targetDateObj = new Date(targetYear, 5, 1, 0, 0, 0);

document.getElementById('yearBadge').textContent = currentYear;
document.getElementById('yearBadgeDisabled').textContent = currentYear;
document.getElementById('footerYear').textContent = currentYear;
document.getElementById('introTargetYear').textContent = `${targetYear}`;
document.getElementById('yearDestination').textContent = `Sampai Jumpa di ${targetYear}`;
const targetYearTexts = document.querySelectorAll('.target-year-text');
targetYearTexts.forEach(el => el.textContent = `${targetYear}`);

// ==================== COUNTDOWN TIMER ====================
function updateCountdown() {
    if (!targetDateObj) return;
    const now = new Date();
    const diff = targetDateObj - now;

    // Elemen countdown form sudah dihilangkan, hanya update jika ada
    const cdYears = document.getElementById('cdYears');
    const cdMonths = document.getElementById('cdMonths');
    const cdDays = document.getElementById('cdDays');
    const cdHours = document.getElementById('cdHours');
    const cdMinutes = document.getElementById('cdMinutes');
    const cdSeconds = document.getElementById('cdSeconds');

    if (diff <= 0) {
        if (cdYears) cdYears.textContent = '0';
        if (cdMonths) cdMonths.textContent = '0';
        if (cdDays) cdDays.textContent = '0';
        if (cdHours) cdHours.textContent = '0';
        if (cdMinutes) cdMinutes.textContent = '0';
        if (cdSeconds) cdSeconds.textContent = '0';
        return;
    }

    const years = Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
    const months = Math.floor((diff % (1000 * 60 * 60 * 24 * 365.25)) / (1000 * 60 * 60 * 24 * 30.44));
    const days = Math.floor((diff % (1000 * 60 * 60 * 24 * 30.44)) / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    if (cdYears) cdYears.textContent = years;
    if (cdMonths) cdMonths.textContent = months;
    if (cdDays) cdDays.textContent = days;
    if (cdHours) cdHours.textContent = hours;
    if (cdMinutes) cdMinutes.textContent = minutes;
    if (cdSeconds) cdSeconds.textContent = seconds;
}

updateCountdown();
setInterval(updateCountdown, 1000); // Update setiap detik

// ==================== PARTICLES ====================
function createParticles() {
    const container = document.getElementById('particles');
    const count = 20;

    for (let i = 0; i < count; i++) {
        const particle = document.createElement('div');
        particle.classList.add('particle');
        particle.style.left = Math.random() * 100 + '%';
        particle.style.animationDuration = (8 + Math.random() * 12) + 's';
        particle.style.animationDelay = (Math.random() * 10) + 's';
        particle.style.width = (2 + Math.random() * 3) + 'px';
        particle.style.height = particle.style.width;
        container.appendChild(particle);
    }
}

createParticles();

// ==================== FORM STATE & SETUP ====================
let isFormActive = false;
const formCard = document.getElementById('capsuleForm');
const formDisabledOverlay = document.getElementById('formDisabledOverlay');
const mainContent = document.getElementById('mainContent');
const introOverlay = document.getElementById('introOverlay');
const submittedPage = document.getElementById('submittedPage');

// Key localStorage (hanya untuk UX post-submit di sesi yang sama)
const SUBMITTED_KEY = `simas_timecapsule_submitted_${currentYear}`;

// Fungsi untuk menampilkan halaman 'Sudah Terkirim'
function showSubmittedPage(nama, kelas) {
    // Sembunyikan semua section lain
    mainContent.style.display = 'none';
    introOverlay.classList.remove('show');
    formDisabledOverlay.style.display = 'none';

    // Tampilkan halaman submitted
    submittedPage.classList.add('show');

    // Isi data user
    document.getElementById('submittedName').textContent = nama || '-';
    document.getElementById('submittedClass').textContent = kelas || '-';
    document.getElementById('submittedYear').textContent = `Sampai Jumpa di ${targetYear}`;

    // Footer year
    document.querySelectorAll('.submitted-footer-year').forEach(el => {
        el.textContent = currentYear;
    });

    // Update countdown di halaman submitted
    function updateSubmittedCountdown() {
        if (!targetDateObj) return;
        const now = new Date();
        const diff = targetDateObj - now;
        if (diff <= 0) {
            document.getElementById('subCdYears').textContent = '0';
            document.getElementById('subCdMonths').textContent = '0';
            document.getElementById('subCdDays').textContent = '0';
            document.getElementById('subCdHours').textContent = '0';
            document.getElementById('subCdMinutes').textContent = '0';
            document.getElementById('subCdSeconds').textContent = '0';
            return;
        }
        const years = Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
        const months = Math.floor((diff % (1000 * 60 * 60 * 24 * 365.25)) / (1000 * 60 * 60 * 24 * 30.44));
        const days = Math.floor((diff % (1000 * 60 * 60 * 24 * 30.44)) / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        document.getElementById('subCdYears').textContent = years;
        document.getElementById('subCdMonths').textContent = months;
        document.getElementById('subCdDays').textContent = days;
        document.getElementById('subCdHours').textContent = hours;
        document.getElementById('subCdMinutes').textContent = minutes;
        document.getElementById('subCdSeconds').textContent = seconds;
    }
    updateSubmittedCountdown();
    setInterval(updateSubmittedCountdown, 1000); // Update tiap detik

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadStudentNames() {
    const dropdownEl = document.getElementById('namaStudentsDropdown');
    const inputNama = document.getElementById('namaLengkap');
    const inputKelas = document.getElementById('kelas');

    if (!dropdownEl || !inputNama || !inputKelas) return;
    let searchTimer = null;
    let searchSequence = 0;

    // Fungsi untuk menyembunyikan dropdown
    const closeDropdown = () => {
        dropdownEl.classList.remove('show');
    };

    // Auto-fill kelas ketika nama dipilih
    const selectStudent = (studentName, studentClass) => {
        inputNama.value = studentName;
        inputKelas.value = studentClass;

        // Kunci input kelas karena sudah otomatis
        inputKelas.setAttribute('readonly', 'true');
        inputKelas.style.background = 'rgba(10, 22, 40, 0.4)';
        inputKelas.style.cursor = 'not-allowed';
        inputKelas.style.opacity = '0.8';
        inputKelas.style.color = '#cbd5e1';
        inputKelas.placeholder = 'Terisi otomatis setelah memilih nama';

        closeDropdown();
    };

    // Event listener pada input untuk memfilter dropdown
    if (!inputNama.dataset.listenerAttached) {
        inputNama.addEventListener('input', (e) => {
            const val = e.target.value.trim().toLowerCase();

            // Otomatis isi kelas "SMAGESA[tahun 2 digit]" jika user mengetik manual
            const autoClass = `SMANTARA${currentYear.toString().slice(-2)}`;
            inputKelas.value = autoClass;

            // Kunci input kelas karena sudah diisi otomatis
            inputKelas.setAttribute('readonly', 'true');
            inputKelas.style.background = 'rgba(10, 22, 40, 0.4)';
            inputKelas.style.cursor = 'not-allowed';
            inputKelas.style.opacity = '0.8';
            inputKelas.style.color = '#cbd5e1';
            inputKelas.placeholder = 'Terisi otomatis';

            const wordCount = val.trim().split(/\s+/).filter(w => w.length > 0).length;
            if (wordCount < 3) {
                clearTimeout(searchTimer);
                closeDropdown();
                return;
            }

            clearTimeout(searchTimer);
            const sequence = ++searchSequence;
            searchTimer = setTimeout(async () => {
                try {
                    const response = await callTimeCapsuleWorker('/api/timecapsule/search-students', {
                        year: currentYear.toString(),
                        query: val
                    });
                    if (sequence !== searchSequence) return;
                    const suggestions = Array.isArray(response.suggestions) ? response.suggestions : [];
                    dropdownEl.replaceChildren();
                    if (suggestions.length > 0) {
                        suggestions.forEach(student => {
                            const item = document.createElement('div');
                            item.className = 'dropdown-item';
                            const nameSpan = document.createElement('span');
                            nameSpan.className = 'dropdown-name';
                            nameSpan.textContent = student.name;
                            const classSpan = document.createElement('span');
                            classSpan.className = 'dropdown-class';
                            classSpan.textContent = student.class;
                            item.append(nameSpan, classSpan);
                            item.addEventListener('click', () => selectStudent(student.name, student.class));
                            dropdownEl.appendChild(item);
                        });
                    } else {
                        const item = document.createElement('div');
                        item.className = 'dropdown-item';
                        const message = document.createElement('span');
                        message.className = 'dropdown-name';
                        message.style.color = 'var(--text-secondary)';
                        message.style.fontStyle = 'italic';
                        message.textContent = `Tidak ditemukan. Kelas akan diset otomatis ke ${autoClass}.`;
                        item.appendChild(message);
                        dropdownEl.appendChild(item);
                    }
                    dropdownEl.classList.add('show');
                } catch (error) {
                    console.error('Gagal mencari nama siswa:', error);
                    if (sequence === searchSequence) closeDropdown();
                }
            }, 350);
        });

        // Hide dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!inputNama.contains(e.target) && !dropdownEl.contains(e.target)) {
                closeDropdown();
            }
        });

        inputNama.dataset.listenerAttached = 'true';
    }
}

async function loadFormState() {
    try {
        const docRef = doc(db, 'kapsul_waktu', currentYear.toString());
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            isFormActive = data.formActive === true;

            // Set tanggal buka & target year secara dinamis
            if (data.tanggalBuka) {
                targetDateObj = new Date(data.tanggalBuka);
                targetYear = targetDateObj.getFullYear();

                // Update text di UI yang bergantung pada tahun
                document.getElementById('introTargetYear').textContent = `${targetYear}`;
                document.getElementById('yearDestination').textContent = `Sampai Jumpa di ${targetYear}`;
                const targetYearTexts = document.querySelectorAll('.target-year-text');
                targetYearTexts.forEach(el => el.textContent = `${targetYear}`);

                // Update teks countdown
                updateCountdown();
            }

            // Set nama angkatan dinamis
            const angkatanNameDisplays = document.querySelectorAll('.angkatan-name-display');
            const defaultAngkatanString = data.namaAngkatan ? data.namaAngkatan : 'Angkatan Terpilih';
            angkatanNameDisplays.forEach(el => {
                el.textContent = defaultAngkatanString;
            });

            // Update Title Document & Meta
            document.title = `Kapsul Waktu Digital | ${defaultAngkatanString}`;
            const metaDesc = document.querySelector('meta[name="description"]');
            if (metaDesc) {
                metaDesc.setAttribute("content", `Kapsul Waktu Digital - ${defaultAngkatanString} ${SCHOOL_CONFIG.schoolName}. Simpan pesanmu untuk dibaca 5 tahun lagi.`);
            }
        } else {
            isFormActive = false;
        }

        // localStorage tidak dipakai untuk blokir form.
        // Duplikasi dicegah oleh Firestore (email sebagai doc ID, rules menolak update).

        updateFormUI();
        if (isFormActive) {
            // Sign in anonymously agar bisa mengakses Firestore sesuai aturan (isSignedIn)
            signInAnonymously(auth).then(() => {
                loadStudentNames();
            }).catch((err) => {
                console.error("Gagal login anonim:", err);
            });
        }
    } catch (e) {
        console.error("Error loading form state:", e);
        isFormActive = false;
        updateFormUI();
    }
}

function updateFormUI() {
    const heroBadge = document.getElementById('heroBadge');
    const heroBadgeText = document.getElementById('heroBadgeText');

    if (isFormActive) {
        heroBadge.classList.remove('disabled');
        if (heroBadge.querySelector('.dot')) {
            heroBadge.querySelector('.dot').style.background = 'var(--gold)';
            heroBadge.querySelector('.dot').style.boxShadow = '0 0 10px rgba(212, 168, 67, 0.4)';
        }
        heroBadgeText.textContent = 'Kapsul Waktu Aktif';
        formCard.classList.remove('disabled');
        formDisabledOverlay.style.display = 'none';
        // mainContent ditampilkan saat intro ditutup
    } else {
        heroBadge.classList.add('disabled');
        if (heroBadge.querySelector('.dot')) {
            heroBadge.querySelector('.dot').style.background = '#e74c3c';
            heroBadge.querySelector('.dot').style.boxShadow = '0 0 10px rgba(231, 76, 60, 0.6)';
        }
        heroBadgeText.textContent = 'Kapsul Waktu Ditutup';
        formCard.classList.add('disabled');

        // Atur layar jadi disabled
        mainContent.style.display = 'none';
        introOverlay.classList.remove('show'); // Pastikan intro hidden
        formDisabledOverlay.style.display = 'block';
    }
}

// ==================== INTRO LOGIC ====================
let currentSlide = 1;
const totalSlides = 5;
const btnIntroNext = document.getElementById('btnIntroNext');
const dots = document.querySelectorAll('.intro-dot');
const slides = document.querySelectorAll('.intro-slide');

function setupIntro() {
    // Intro selalu muncul saat halaman dimuat (jika form aktif), termasuk jika sudah pernah submit
    if (isFormActive) {
        introOverlay.classList.add('show');
        mainContent.style.display = 'none';
    }
}

function updateIntro() {
    slides.forEach((slide, idx) => {
        if (idx + 1 === currentSlide) {
            slide.classList.add('active');
        } else {
            slide.classList.remove('active');
        }
    });
    dots.forEach((dot, idx) => {
        if (idx + 1 === currentSlide) {
            dot.classList.add('active');
        } else {
            dot.classList.remove('active');
        }
    });

    if (currentSlide === totalSlides) {
        btnIntroNext.innerHTML = 'Mulai Menulis ✦';
    } else {
        btnIntroNext.innerHTML = 'Lanjut ✦';
    }
}

btnIntroNext.addEventListener('click', () => {
    if (currentSlide < totalSlides) {
        currentSlide++;
        updateIntro();
    } else {
        closeIntro();
    }
});

dots.forEach((dot) => {
    dot.addEventListener('click', () => {
        const targetSlide = parseInt(dot.getAttribute('data-slide'));
        if (targetSlide && targetSlide !== currentSlide) {
            currentSlide = targetSlide;
            updateIntro();
        }
    });
});

function closeIntro() {
    introOverlay.classList.remove('show');
    if (isFormActive) {
        mainContent.style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    // localStorage.setItem dihilangkan agar intro muncul selalu
}

// Initialize form state, lalu setup intro
loadFormState().then(() => {
    setupIntro();
});

// ==================== FOTO UPLOAD: KOMPRESI & PREVIEW ====================
const fotoKamera = document.getElementById('fotoKamera');
const fotoGaleri = document.getElementById('fotoGaleri');
const btnBukaKamera = document.getElementById('btnBukaKamera');
const btnPilihGaleri = document.getElementById('btnPilihGaleri');
const fotoUploadArea = document.getElementById('fotoUploadArea');
const fotoPreview = document.getElementById('fotoPreview');
const fotoPreviewImg = document.getElementById('fotoPreviewImg');
const fotoOriginalSizeEl = document.getElementById('fotoOriginalSize');
const fotoCompressedInfoEl = document.getElementById('fotoCompressedInfo');
const fotoProgress = document.getElementById('fotoProgress');
const fotoProgressFill = document.getElementById('fotoProgressFill');
const fotoProgressText = document.getElementById('fotoProgressText');
const fotoError = document.getElementById('fotoError');
const btnRemoveFoto = document.getElementById('btnRemoveFoto');

// Helper: format ukuran file
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// Helper: tampilkan error foto
function showFotoError(msg) {
    fotoError.textContent = msg;
    fotoError.classList.add('show');
    setTimeout(() => fotoError.classList.remove('show'), 6000);
}

// Helper: reset state foto
function resetFotoState() {
    compressedFotoBase64 = null;
    compressedFotoBlob = null;
    fotoOriginalSize = 0;
    fotoCompressedSize = 0;
    fotoUploaded = false;
    uploadedFotoData = null;
    fotoPreview.classList.remove('show');
    fotoUploadArea.style.display = '';
    fotoUploadArea.classList.remove('has-photo');
    fotoKamera.value = '';
    fotoGaleri.value = '';
    fotoError.classList.remove('show');
    fotoProgress.classList.remove('show');
}

/**
 * Kompresi gambar menggunakan Canvas API (Optimasi 200 user bersamaan)
 * - Resize sisi terpanjang ke maxDimension (default 1280px, cukup untuk email)
 * - Loop turunkan JPEG quality sampai ukuran ≤ maxSizeBytes (500KB)
 * - Hasil lebih kecil = upload ke GAS lebih cepat = antrian lebih pendek
 * - Return: {base64, blob, compressedSize}
 */
async function compressImage(file, maxSizeBytes = 500 * 1024, maxDimension = 1280) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            // Selalu lakukan resize & kompresi untuk konsistensi ukuran upload
            const img = new Image();
            img.onload = () => {
                // Hitung dimensi baru (proporsional)
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

                // Loop kompresi: mulai dari quality 0.85, turun 0.05 per iterasi
                let quality = 0.85;

                const tryCompress = () => {
                    // Update progress
                    const progress = Math.min(90, Math.round((0.85 - quality) / 0.75 * 90));
                    fotoProgressFill.style.width = progress + '%';
                    fotoProgressText.textContent = `Mengompresi... (quality: ${Math.round(quality * 100)}%)`;

                    canvas.toBlob((result) => {
                        if (!result) {
                            reject(new Error('Gagal mengompresi gambar'));
                            return;
                        }

                        if (result.size <= maxSizeBytes || quality <= 0.1) {
                            // Selesai! Konversi ke base64
                            const readerResult = new FileReader();
                            readerResult.onloadend = () => {
                                const fullBase64 = readerResult.result;
                                const pureBase64 = fullBase64.split(',')[1];

                                fotoProgressFill.style.width = '100%';
                                fotoProgressText.textContent = 'Kompresi selesai!';

                                resolve({
                                    base64: pureBase64,
                                    blob: result,
                                    compressedSize: result.size,
                                    previewUrl: fullBase64
                                });
                            };
                            readerResult.readAsDataURL(result);
                        } else {
                            // Masih terlalu besar, turunkan quality
                            quality -= 0.05;
                            setTimeout(tryCompress, 10); // yield ke UI thread
                        }
                    }, 'image/jpeg', quality);
                };

                tryCompress();
            };
            img.onerror = () => reject(new Error('Gagal memuat gambar'));
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('Gagal membaca file'));
        reader.readAsDataURL(file);
    });
}

/**
 * Upload foto ke Google Apps Script Web App
 * Dengan RETRY + RANDOM DELAY + STAGGER
 * Dirancang untuk 200 user bersamaan:
 * - Random delay awal 0-5 detik (agar tidak semua hit GAS bersamaan)
 * - Retry 5x dengan jeda random 2-8 detik jika gagal/timeout
 * - Timeout per request: 30 detik
 * Return: {fileId, url} atau throw error
 */
const UPLOAD_MAX_RETRIES = 5;
const UPLOAD_TIMEOUT_MS = 30000;    // 30 detik timeout per request
const UPLOAD_STAGGER_MAX_MS = 5000; // Random delay awal 0-5 detik
const RETRY_MIN_DELAY_MS = 2000;    // Jeda minimum antar retry: 2 detik
const RETRY_MAX_DELAY_MS = 8000;    // Jeda maksimum antar retry: 8 detik

async function uploadFotoToGAS(base64Data, email, tahun) {
    // Satu requestId dipakai ulang pada seluruh retry agar respons yang hilang
    // tidak membuat file Drive duplikat.
    const requestId = crypto.randomUUID();
    // Stagger delay: random 0-5 detik agar 200 user tidak hit GAS bersamaan
    const staggerDelay = Math.random() * UPLOAD_STAGGER_MAX_MS;
    fotoProgressText.textContent = 'Menunggu giliran upload...';
    await new Promise(r => setTimeout(r, staggerDelay));

    let lastError = null;

    for (let attempt = 1; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
        try {
            fotoProgressText.textContent = attempt > 1
                ? `Mencoba ulang upload... (percobaan ${attempt}/${UPLOAD_MAX_RETRIES})`
                : 'Mengunggah foto ke server...';
            fotoProgressFill.style.width = `${40 + (attempt - 1) * 12}%`;

            // Fetch dengan timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

            const response = await fetch(GAS_WEBAPP_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    foto: base64Data,
                    email: email,
                    tahun: tahun,
                    requestId
                }),
                redirect: 'follow',
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            const text = await response.text();
            let result;
            try {
                result = JSON.parse(text);
            } catch (e) {
                throw new Error('Response server tidak valid.');
            }

            if (!result.success) {
                throw new Error(result.error || 'Upload foto gagal');
            }

            // Berhasil!
            return { fileId: result.fileId, url: result.url };

        } catch (error) {
            lastError = error;
            console.warn(`Upload attempt ${attempt}/${UPLOAD_MAX_RETRIES} gagal:`, error.message);

            if (attempt < UPLOAD_MAX_RETRIES) {
                // Random delay 2-8 detik (tiap user dapat jeda berbeda, menghindari tabrakan)
                const randomDelay = RETRY_MIN_DELAY_MS + Math.random() * (RETRY_MAX_DELAY_MS - RETRY_MIN_DELAY_MS);
                fotoProgressText.textContent = `Server sibuk, mencoba lagi dalam ${Math.ceil(randomDelay / 1000)} detik...`;
                await new Promise(r => setTimeout(r, randomDelay));
            }
        }
    }

    // Semua retry habis
    throw new Error(`Upload gagal setelah ${UPLOAD_MAX_RETRIES}x percobaan: ${lastError?.message || 'Unknown error'}`);
}

// Event: User memilih foto → kompresi → AUTO UPLOAD ke Google Drive
async function handleFotoSelected(file) {
    // Validasi tipe file
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (!allowedTypes.includes(file.type)) {
        showFotoError('Format tidak didukung. Gunakan JPG atau PNG.');
        return;
    }

    // Validasi ukuran asli (maks 10MB)
    if (file.size > 10 * 1024 * 1024) {
        showFotoError('Ukuran foto terlalu besar. Maksimal 10MB.');
        return;
    }

    // Validasi: email harus sudah diisi (sebagai identitas overwrite di Drive)
    const emailValue = document.getElementById('email').value.trim().toLowerCase();
    if (!emailValue || !emailValue.includes('@')) {
        showFotoError('Isi alamat email (field 3) terlebih dahulu sebelum upload foto.');
        return;
    }

    fotoOriginalSize = file.size;

    // Reset state upload sebelumnya (kalau ganti foto)
    fotoUploaded = false;
    uploadedFotoData = null;

    // Tampilkan progress
    fotoError.classList.remove('show');
    fotoProgress.classList.add('show');
    fotoProgressFill.style.width = '0%';
    fotoProgressText.textContent = 'Mengompresi foto...';
    fotoUploadArea.style.display = 'none';
    fotoPreview.classList.remove('show');

    try {
        // === STEP 1: Kompresi foto (maks 500KB, resolusi 1280px) ===
        const result = await compressImage(file);

        compressedFotoBase64 = result.base64;
        compressedFotoBlob = result.blob;
        fotoCompressedSize = result.compressedSize;

        // Tampilkan preview
        fotoPreviewImg.src = result.previewUrl;
        fotoOriginalSizeEl.textContent = `Asli: ${formatFileSize(fotoOriginalSize)}`;

        if (fotoCompressedSize < fotoOriginalSize) {
            fotoCompressedInfoEl.textContent = ` → Dikompresi: ${formatFileSize(fotoCompressedSize)}`;
        } else {
            fotoCompressedInfoEl.textContent = ` (${formatFileSize(fotoCompressedSize)})`;
        }

        // Tampilkan preview
        fotoProgress.classList.remove('show');
        fotoPreview.classList.add('show');

        // === STEP 2: Auto-upload ke Google Drive via GAS (dengan retry) ===
        fotoProgress.classList.add('show');
        fotoProgressFill.style.width = '40%';

        const tahun = new Date().getFullYear().toString();
        const fotoData = await uploadFotoToGAS(compressedFotoBase64, emailValue, tahun);

        fotoUploaded = true;
        uploadedFotoData = fotoData;

        // Upload berhasil — update UI
        fotoProgressFill.style.width = '100%';
        fotoProgressText.textContent = '✓ Foto berhasil diunggah!';
        setTimeout(() => {
            fotoProgress.classList.remove('show');
        }, 1500);

        console.log('Foto auto-uploaded:', fotoData);

    } catch (error) {
        console.error('Gagal proses foto:', error);

        // Jika kompresi berhasil tapi upload gagal → simpan foto lokal, bisa submit tanpa upload
        if (compressedFotoBase64) {
            fotoProgress.classList.remove('show');
            fotoPreview.classList.add('show');
            fotoUploaded = false;
            uploadedFotoData = null;
            showFotoError('⚠️ Server sibuk, foto gagal diunggah. Kamu tetap bisa kirim kapsul waktu tanpa foto, atau coba pilih ulang foto nanti.');
        } else {
            showFotoError('Gagal memproses foto: ' + error.message);
            fotoProgress.classList.remove('show');
            fotoUploadArea.style.display = '';
            fotoPreview.classList.remove('show');
            compressedFotoBase64 = null;
            fotoUploaded = false;
            uploadedFotoData = null;
        }
    }
}

// Listener: Tombol "Buka Kamera" → trigger input dengan capture=user
btnBukaKamera.addEventListener('click', () => {
    fotoKamera.click();
});

// Listener: Tombol "Pilih dari Galeri" → trigger input tanpa capture
btnPilihGaleri.addEventListener('click', () => {
    fotoGaleri.click();
});

// Listener: Input kamera berubah
fotoKamera.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFotoSelected(file);
});

// Listener: Input galeri berubah
fotoGaleri.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFotoSelected(file);
});

// Listener: drag & drop (tetap untuk desktop)
fotoUploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    fotoUploadArea.classList.add('dragover');
});

fotoUploadArea.addEventListener('dragleave', () => {
    fotoUploadArea.classList.remove('dragover');
});

fotoUploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    fotoUploadArea.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleFotoSelected(file);
});

// Listener: hapus foto
btnRemoveFoto.addEventListener('click', () => {
    resetFotoState();
});

// ==================== FORM SUBMIT ====================
const form = document.getElementById('capsuleForm');
const btnSubmit = document.getElementById('btnSubmit');
const loadingOverlay = document.getElementById('loadingOverlay');
const successModal = document.getElementById('successModal');

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!isFormActive) {
        showAlert('Maaf, pengisian kapsul waktu saat ini sedang dinonaktifkan.', '🔒');
        return;
    }

    // Validasi semua field wajib
    const requiredFields = form.querySelectorAll('[required]:not([type="file"])');
    let isValid = true;
    let firstInvalidField = null;

    requiredFields.forEach(field => {
        if (!field.value.trim()) {
            isValid = false;
            field.style.borderColor = 'var(--accent-rose)';
            if (!firstInvalidField) firstInvalidField = field;
            field.addEventListener('input', () => {
                field.style.borderColor = 'var(--input-border)';
            }, { once: true });
        }
    });

    // Validasi foto: wajib dipilih, tapi upload boleh gagal (fallback tanpa foto)
    if (!compressedFotoBase64 && !fotoUploaded) {
        // Foto belum dipilih sama sekali
        isValid = false;
        if (!firstInvalidField) firstInvalidField = document.getElementById('fotoUploadArea');
        showFotoError('Foto wajib dipilih. Pilih 1 foto terbaikmu.');
        fotoUploadArea.style.borderColor = 'var(--accent-rose)';
        setTimeout(() => {
            fotoUploadArea.style.borderColor = '';
        }, 4000);
    }
    // Catatan: jika foto sudah dipilih & dikompresi tapi upload gagal (compressedFotoBase64 ada, fotoUploaded false),
    // kita tetap izinkan submit → data teks tetap masuk, foto bisa di-retry nanti via admin.

    // Validasi email (format harus valid)
    const emailField = document.getElementById('email');
    const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(emailField.value.trim())) {
        isValid = false;
        emailField.style.borderColor = 'var(--accent-rose)';
        if (!firstInvalidField) firstInvalidField = emailField;
        showAlert('Format email tidak valid. Contoh: nama@gmail.com', '📧');
    }

    // Validasi WhatsApp (hanya angka, minimal 10 digit)
    const waField = document.getElementById('whatsapp');
    const waValue = waField.value.trim();
    if (!/^\d+$/.test(waValue)) {
        isValid = false;
        waField.style.borderColor = 'var(--accent-rose)';
        if (!firstInvalidField) firstInvalidField = waField;
        showAlert('Nomor WhatsApp hanya boleh berisi angka.', '📱');
    } else if (waValue.length < 10 || waValue.length > 15) {
        isValid = false;
        waField.style.borderColor = 'var(--accent-rose)';
        if (!firstInvalidField) firstInvalidField = waField;
        showAlert('Nomor WhatsApp harus antara 10-15 digit.', '📱');
    }

    // Validasi Tiga Kata (harus tepat 3 kata)
    const tigaKataField = document.getElementById('tigaKata');
    const tigaKataVal = tigaKataField.value.trim();
    const tigaKataWords = tigaKataVal.split(/[,\s]+/).filter(w => w.length > 0);
    if (tigaKataWords.length !== 3) {
        isValid = false;
        tigaKataField.style.borderColor = 'var(--accent-rose)';
        if (!firstInvalidField) firstInvalidField = tigaKataField;
        showAlert('Field "Tiga Kata" harus diisi tepat 3 kata. Saat ini: ' + tigaKataWords.length + ' kata.', '✏️');
        tigaKataField.addEventListener('input', () => {
            tigaKataField.style.borderColor = 'var(--input-border)';
        }, { once: true });
    }

    if (!isValid) {
        if (firstInvalidField) {
            firstInvalidField.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
    }

    // Disable tombol & tampilkan loading
    btnSubmit.disabled = true;
    loadingOverlay.classList.add('show');

    const namaValue = document.getElementById('namaLengkap').value.trim();
    const kelasValue = document.getElementById('kelas').value.trim();
    const emailValue = document.getElementById('email').value.trim().toLowerCase();
    const tahun = currentYear.toString();

    // Semua penulisan dilakukan oleh Cloudflare Worker terverifikasi. Browser tidak
    // lagi mempunyai izin menulis Firestore atau menimpa data berdasarkan email.
    const doSubmit = async (isOverwrite = false) => {
        // Foto sudah di-upload otomatis saat user memilih foto
        const fotoData = uploadedFotoData || { fileId: null, url: null };

        if (!auth.currentUser) {
            await signInAnonymously(auth);
        }

        const editTokenKey = getEditTokenKey(tahun, emailValue);
        const editToken = isOverwrite ? localStorage.getItem(editTokenKey) : null;
        if (isOverwrite && !editToken) {
            const missingTokenError = new Error('Kunci edit tidak tersedia di browser ini. Hubungi admin jika data lama memang perlu diganti.');
            missingTokenError.code = 'local/no-edit-token';
            throw missingTokenError;
        }

        const submission = {
            namaLengkap: namaValue,
            kelas: kelasValue,
            email: emailValue,
            whatsapp: document.getElementById('whatsapp').value.trim(),
            medsos: document.getElementById('medsos').value.trim() || null,
            tigaKata: document.getElementById('tigaKata').value.trim(),
            memori: document.getElementById('memori').value.trim(),
            lagu: document.getElementById('lagu').value.trim(),
            refleksi: document.getElementById('refleksi').value.trim(),
            sosok: document.getElementById('sosok').value.trim(),
            targetBesar: document.getElementById('targetBesar').value.trim(),
            prinsip: document.getElementById('prinsip').value.trim(),
            pesanPengingat: document.getElementById('pesanPengingat').value.trim(),
            harapanSekolah: document.getElementById('harapanSekolah').value.trim(),
            fotoUrl: fotoData.url || null,
            fotoFileId: fotoData.fileId || null
        };

        const result = await callTimeCapsuleWorker('/api/timecapsule/submit', {
            year: tahun,
            submission,
            overwrite: isOverwrite,
            editToken
        });
        try {
            if (result.editToken) {
                localStorage.setItem(editTokenKey, result.editToken);
            }
            localStorage.setItem(SUBMITTED_KEY, JSON.stringify({
                nama: namaValue,
                kelas: kelasValue,
                submittedAt: new Date().toISOString()
            }));
        } catch (storageError) {
            // Penyimpanan server sudah berhasil; kegagalan storage browser tidak
            // boleh membuat pengguna mengirim duplikat karena melihat pesan gagal.
            console.warn('Kapsul tersimpan, tetapi browser tidak dapat menyimpan kunci edit:', storageError);
        }

        // Berhasil!
        loadingOverlay.classList.remove('show');
        successModal.classList.add('show');
        form.reset();
        resetFotoState();
        btnSubmit.disabled = false;
        document.querySelector('.loading-text').textContent = 'Mengamankan pesanmu ke masa depan...';
    };

    try {
        document.querySelector('.loading-text').textContent = 'Mengamankan pesanmu ke masa depan...';
        await doSubmit(false); // Coba submit normal (create)
    } catch (error) {
        console.error('Error menyimpan kapsul waktu:', error);

        const errorCode = String(error.code || '');
        // Kode already-exists berasal dari server; overwrite hanya ditawarkan bila
        // browser masih menyimpan kunci edit dari pengiriman pertama.
        if (errorCode.includes('already-exists')) {
            // Sembunyikan loading sementara
            loadingOverlay.classList.remove('show');

            if (!localStorage.getItem(getEditTokenKey(tahun, emailValue))) {
                btnSubmit.disabled = false;
                showAlert('Data dengan email ini sudah ada. Demi keamanan, data lama hanya bisa diganti dari browser yang digunakan saat pengiriman pertama. Hubungi admin bila perlu koreksi.', '🔒');
                return;
            }

            showConfirm(
                'Data dengan email ini sudah ada. Apakah Anda ingin mengganti (overwrite) data kapsul waktu yang sudah tersimpan sebelumnya?',
                async () => {
                    // Jika klik "Ya, Timpa Data"
                    loadingOverlay.classList.add('show');
                    document.querySelector('.loading-text').textContent = 'Mengganti pesan lamamu...';
                    try {
                        await doSubmit(true);
                    } catch (err) {
                        loadingOverlay.classList.remove('show');
                        btnSubmit.disabled = false;
                        document.querySelector('.loading-text').textContent = 'Mengamankan pesanmu ke masa depan...';

                        if (String(err.code || '').includes('permission-denied') || err.code === 'local/no-edit-token') {
                            showAlert('Gagal mengganti data. Kunci edit hanya tersedia di browser yang digunakan saat pengiriman pertama. Hubungi admin bila perlu koreksi.', '🔒');
                        } else {
                            showAlert('Maaf, terjadi kesalahan saat mengganti data: ' + err.message, '❌');
                        }
                    }
                },
                '🔄'
            );
        } else {
            loadingOverlay.classList.remove('show');
            btnSubmit.disabled = false;
            document.querySelector('.loading-text').textContent = 'Mengamankan pesanmu ke masa depan...';
            showAlert('Maaf, terjadi kesalahan saat menyimpan kapsul waktumu. Silakan coba lagi. Detail: ' + error.message, '❌');
        }
    }
});

// ==================== CLOSE MODAL → TAMPILKAN HALAMAN SUBMITTED ====================
document.getElementById('btnCloseModal').addEventListener('click', () => {
    successModal.classList.remove('show');

    // Ambil data dari localStorage yang baru disimpan
    const submittedData = localStorage.getItem(SUBMITTED_KEY);
    let nama = '-', kelas = '-';
    if (submittedData) {
        try {
            const parsed = JSON.parse(submittedData);
            nama = parsed.nama;
            kelas = parsed.kelas;
        } catch (e) { }
    }

    // Tampilkan halaman 'Sudah Terkirim' menggantikan form
    showSubmittedPage(nama, kelas);
});

// ==================== BUKA LEMBARAN BUKU (FORM) ====================
const btnOpenBook = document.getElementById('btnOpenBook');
const preFormConfirm = document.getElementById('preFormConfirm');

if (btnOpenBook) {
    btnOpenBook.addEventListener('click', () => {
        // Hilangkan landing konfirmasi
        preFormConfirm.style.opacity = '0';
        setTimeout(() => {
            preFormConfirm.style.display = 'none';
            // Tampilkan form
            formCard.style.display = 'block';

            setTimeout(() => {
                formCard.style.opacity = '1';
                formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 50);
        }, 300); // Tunggu transisi opacity
    });

    // hover animation inline fallback
    btnOpenBook.addEventListener('mouseover', () => {
        btnOpenBook.style.transform = 'scale(1.05)';
    });
    btnOpenBook.addEventListener('mouseout', () => {
        btnOpenBook.style.transform = 'scale(1)';
    });
}

// ==================== INTRO SPLASH (~5 DETIK) ====================
const introSplash = document.getElementById('introSplash');
const introContentEl = document.getElementById('introContent');

function startSplashIntro() {
    // Setelah ~5 detik, transisi dari splash ke slides
    setTimeout(() => {
        introSplash.classList.add('hide');
        introContentEl.style.display = '';
        introContentEl.style.opacity = '0';
        introContentEl.style.transition = 'opacity 0.6s ease';
        setTimeout(() => {
            introContentEl.style.opacity = '1';
        }, 100);
    }, 5000);
}

// Jalankan splash jika intro aktif
if (introOverlay.classList.contains('show')) {
    startSplashIntro();
}

// ==================== AUTO-CAPITALIZE NAMA (HURUF KAPITAL TIAP KATA) ====================
const namaInput = document.getElementById('namaLengkap');
namaInput.addEventListener('input', function () {
    const pos = this.selectionStart;
    this.value = this.value.replace(/(^|\s)(\S)/g, (match, space, char) => space + char.toUpperCase());
    this.setSelectionRange(pos, pos);
});

// ==================== AUTO-UPPERCASE KELAS ====================
const kelasInput = document.getElementById('kelas');
kelasInput.addEventListener('input', function () {
    const pos = this.selectionStart;
    this.value = this.value.toUpperCase();
    this.setSelectionRange(pos, pos);
});

// ==================== AUTO-CAPITALIZE KALIMAT (TEXTAREA & TEXT INPUT LAINNYA) ====================
function capitalizeSentences(str) {
    // Kapital di awal string dan setelah tanda titik/tanya/seru diikuti spasi
    return str.replace(/(^|[.!?]\s+)(\S)/g, (match, prefix, char) => prefix + char.toUpperCase());
}

// Daftar field teks yang perlu auto-capitalize kalimat
const sentenceFields = ['memori', 'refleksi', 'sosok', 'targetBesar', 'prinsip', 'pesanPengingat', 'harapanSekolah', 'lagu', 'tigaKata', 'medsos'];
sentenceFields.forEach(fieldId => {
    const el = document.getElementById(fieldId);
    if (el) {
        el.addEventListener('input', function () {
            const pos = this.selectionStart;
            this.value = capitalizeSentences(this.value);
            this.setSelectionRange(pos, pos);
        });
    }
});

// ==================== TIGA KATA: WORD COUNTER ====================
const tigaKataInput = document.getElementById('tigaKata');
const tigaKataCounter = document.getElementById('tigaKataCounter');

if (tigaKataInput && tigaKataCounter) {
    tigaKataInput.addEventListener('input', function () {
        const words = this.value.trim().split(/[,\s]+/).filter(w => w.length > 0);
        const count = words.length;
        tigaKataCounter.textContent = count + ' / 3 kata';
        tigaKataCounter.className = 'word-counter';
        if (count === 3) {
            tigaKataCounter.classList.add('valid');
        } else if (count > 3) {
            tigaKataCounter.classList.add('error');
        }
    });
}
