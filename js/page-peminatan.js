/* js/page-peminatan.js */
import { auth, db, PATHS } from './config.js';
import { cfClient } from './cloudflare-client.js';
import { initLayout } from './global.js';
import { verifyStudentSession, isRecoverableStudentSessionError, isExpiredStudentSessionError } from './student-session.mjs';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp, collection, query, where, limit, getDocs, collectionGroup } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

let currentStudent = null;
let allQuestions = [];
let userResponses = {};
let currentLayout = "classic";
let currentStep = 0;
let currentTA = "2024/2025"; 
let activeWeights = {};
let availableAspects = [];
let evaluatedAspects = [];

let peminatanSessionCheck = 0;
let peminatanSessionRetryTimer = null;
let peminatanRecoveryNoticeShown = false;
async function restorePeminatanSession(user) {
    const check = ++peminatanSessionCheck;
    clearTimeout(peminatanSessionRetryTimer);
    peminatanSessionRetryTimer = null;
    if (window._simasIdleLogoutInProgress) return;
    const isCurrentSession = () => check === peminatanSessionCheck && auth.currentUser === user;
    const sessionNIS = sessionStorage.getItem('student_nis');

    if (user) {
        if (user.isAnonymous && !sessionNIS) {
            window.location.replace('portal-siswa.html');
            return;
        }
        // Ada sesi valid dan auth aktif, langsung load data
        try {
            // 1. Ambil Identitas Siswa/Admin
            let studentDoc = null;
            let isStudent = true;

            if (sessionNIS && user.isAnonymous) {
                await verifyStudentSession(user, sessionNIS, { isCurrent: isCurrentSession });

                // Ambil Profil Siswa langsung dari Cloudflare D1 (Master Tunggal)
                let sData = null;
                try {
                    if (cfClient && cfClient.enabled) {
                        const cfS = await cfClient.getStudentByNis(sessionNIS);
                        if (cfS) sData = cfS;
                    }
                } catch (e) {
                    if (isRecoverableStudentSessionError(e)) throw e;
                }

                if (!sData && typeof window.getStudentByNIS === 'function') {
                    sData = await window.getStudentByNIS(sessionNIS);
                }

                if (sData) {
                    studentDoc = { exists: () => true, data: () => sData };
                }
            }

            // Jika sessionNIS tidak ada, atau studentDoc tidak ditemukan, cek di koleksi users (Admin/Staff)
            if (!studentDoc) {
                if (user.isAnonymous) throw new Error('Data siswa belum dapat dimuat. Silakan muat ulang halaman.');
                const cachedUserDoc = await window.getCurrentUserDoc();
                if (!isCurrentSession()) return;
                if (cachedUserDoc) {
                    // Bungkus agar kompatibel dengan .data() pattern
                    studentDoc = { exists: () => true, data: () => cachedUserDoc };
                    isStudent = false;
                } else {
                    sessionStorage.clear();
                    window.location.replace('index.html');
                    return;
                }
            }

            if (!isCurrentSession()) return;
            currentStudent = studentDoc.data();
            currentStudent.uid = user.uid;
            currentStudent.isStudent = isStudent;

            // Sinkronkan data session user anonim secara senyap ke Firestore /student_sessions/{uid} (untuk keperluan firestore.rules)
            if (isStudent && user.isAnonymous) {
                const sessionRef = doc(db, 'student_sessions', user.uid);
                setDoc(sessionRef, {
                    nis: sessionNIS,
                    class: currentStudent.class || '-',
                    name: currentStudent.name || '-',
                    updatedAt: serverTimestamp()
                }, { merge: true }).catch(err => console.warn('[Peminatan] Gagal mendaftarkan student session:', err));
            }

            // 2. Setup UI Header
            document.getElementById('student-name').innerText = currentStudent.name + (!isStudent ? ' (Admin Preview)' : '');
            document.getElementById('student-nis').innerText = currentStudent.nis || currentStudent.email || currentStudent.username || '-';
            
            // 3. Ambil TA Aktif (SSOT) - Sekarang otomatis menggunakan waktu kalender
            currentTA = window.getCurrentAcademicYearString ? window.getCurrentAcademicYearString() : (() => {
                const now = new Date();
                const month = now.getMonth();
                const year = now.getFullYear();
                const startYear = (month >= 6) ? year : year - 1;
                return `${startYear}/${startYear + 1}`;
            })();
            // Folder tahun kuesioner menggunakan tahun kalender saat ini secara langsung (yaitu 2026) agar sinkron dengan dashboard hasil BK
            const activeYearDoc = new Date().getFullYear().toString();
            
            const taEl = document.getElementById('current-ta');
            if (taEl) taEl.innerText = `TA ${currentTA}`;

            // 4. Init Page (Standalone - Tanpa Sidebar)
            document.body.style.display = 'block';
            setupHonestyModal();

            // Jika bukan siswa, beri peringatan preview
            if (!isStudent) {
                // Tampilkan Toast jika initLayout tersedia
                if (typeof window.showToast === 'function') {
                    window.showToast("Mode Preview", "Anda masuk sebagai Admin. Fitur kirim jawaban dinonaktifkan.", "info");
                }
                const submitBtn = document.getElementById('btn-submit-peminatan');
                if (submitBtn) submitBtn.title = "Hanya siswa yang dapat mengirim jawaban";
            }

            // 5. Load Questions
            peminatanRecoveryNoticeShown = false;
            loadQuestions();

        } catch (e) {
            if (!isCurrentSession() || e?.code === 'session/superseded') return;
            console.error("Auth Error:", e);
            if (isRecoverableStudentSessionError(e)) {
                peminatanSessionRetryTimer = setTimeout(() => {
                    peminatanSessionRetryTimer = null;
                    void restorePeminatanSession(auth.currentUser);
                }, 15000);
                if (!peminatanRecoveryNoticeShown && typeof window.showToast === 'function') {
                    window.showToast('Memulihkan Sesi', 'Koneksi sedang terganggu. Aplikasi akan mencoba kembali secara otomatis.', 'warning', 6000);
                    peminatanRecoveryNoticeShown = true;
                }
                return;
            }
            if (user?.isAnonymous && (isExpiredStudentSessionError(e) || e?.code === 'session/identity-mismatch')) {
                if (isExpiredStudentSessionError(e)) await signOut(auth).catch(() => {});
                if (check !== peminatanSessionCheck) return;
                sessionStorage.clear();
                window.location.replace('index.html?status=session_invalid');
                return;
            }
            if (typeof window.showToast === 'function') {
                window.showToast("Error", "Gagal memproses data profil.", "error");
            }
        }
    } else if (sessionNIS && !user) {
        // SessionStorage dapat dipalsukan dan tidak dapat menggantikan custom claim.
        sessionStorage.clear();
        window.location.replace('index.html?status=session_unavailable');
    } else {
        // Tidak ada sesi valid sama sekali, kembalikan ke login
        sessionStorage.clear();
        window.location.replace('index.html');
    }
}
const retryPeminatanSession = () => {
    if (peminatanSessionRetryTimer !== null && document.visibilityState !== 'hidden') {
        void restorePeminatanSession(auth.currentUser);
    }
};
window.addEventListener('online', retryPeminatanSession);
document.addEventListener('visibilitychange', retryPeminatanSession);
onAuthStateChanged(auth, restorePeminatanSession);

function setupHonestyModal() {
    const modal = document.getElementById('modal-honesty');
    const check = document.getElementById('check-honesty');
    const btn = document.getElementById('btn-start-peminatan');

    check.onchange = (e) => {
        if (e.target.checked) {
            btn.disabled = false;
            btn.classList.remove('bg-slate-200', 'dark:bg-slate-700', 'text-slate-400', 'dark:text-slate-500', 'cursor-not-allowed');
            btn.classList.add('bg-indigo-600', 'hover:bg-indigo-700', 'text-white', 'shadow-xl', 'shadow-indigo-200', 'dark:shadow-none', 'active:scale-95');
        } else {
            btn.disabled = true;
            btn.classList.add('bg-slate-200', 'dark:bg-slate-700', 'text-slate-400', 'dark:text-slate-500', 'cursor-not-allowed');
            btn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700', 'text-white', 'shadow-xl', 'shadow-indigo-200', 'dark:shadow-none', 'active:scale-95');
        }
    };

    btn.onclick = () => {
        modal.classList.add('hidden');
        document.querySelector('main').classList.remove('hidden');
        window.scrollTo(0, 0);
    };

    // Setup Final Confirm Modal Logic
    const checkFinal = document.getElementById('check-confirm-final');
    const btnFinal = document.getElementById('btn-final-confirm');
    if (checkFinal && btnFinal) {
        checkFinal.onchange = (e) => {
            if (e.target.checked) {
                btnFinal.disabled = false;
                btnFinal.classList.remove('bg-slate-200', 'dark:bg-slate-700', 'text-slate-400', 'dark:text-slate-500', 'cursor-not-allowed');
                btnFinal.classList.add('bg-indigo-600', 'hover:bg-indigo-700', 'text-white', 'shadow-lg', 'shadow-indigo-200', 'dark:shadow-none', 'active:scale-95');
            } else {
                btnFinal.disabled = true;
                btnFinal.classList.add('bg-slate-200', 'dark:bg-slate-700', 'text-slate-400', 'dark:text-slate-500', 'cursor-not-allowed');
                btnFinal.classList.remove('bg-indigo-600', 'hover:bg-indigo-700', 'text-white', 'shadow-lg', 'shadow-indigo-200', 'dark:shadow-none', 'active:scale-95');
            }
        };
    }
}

async function loadQuestions() {
    const container = document.getElementById('questionnaire-container');
    
    try {
        const data = await cfClient.getPeminatanConfig();
        
        // Cek Status Aktif
        if (!data || data.isActive === false) {
            container.innerHTML = `
                <div class="py-20 px-8 text-center bg-white dark:bg-slate-800 rounded-[2.5rem] shadow-sm border dark:border-slate-700 animate-zoom-in">
                    <div class="w-20 h-20 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto mb-6 text-4xl">
                        <i class="fa-solid fa-lock"></i>
                    </div>
                    <h2 class="text-2xl font-black text-slate-800 dark:text-white mb-2">Kuesioner Ditutup</h2>
                    <p class="text-slate-500 dark:text-slate-400 max-w-xs mx-auto mb-8">Maaf, akses pengisian kuesioner peminatan saat ini sedang dinonaktifkan oleh Admin BK.</p>
                    <button onclick="window.location.replace('portal-siswa.html')" class="px-8 py-3 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-bold rounded-2xl transition-all active:scale-95">Kembali ke Dashboard</button>
                </div>
            `;
            hideLayoutElements();
            return;
        }

        // Cek apakah sudah pernah mengisi di tahun mana pun (Hanya 1x seumur hidup siswa - Lewati jika admin/guru BK)
        if (currentStudent.isStudent) {
            const statusRes = await cfClient.getPeminatanStatus(currentStudent.nis || 'unknown');
            if (statusRes?.hasSubmitted) {
                container.innerHTML = `
                    <div class="py-20 px-8 text-center bg-white dark:bg-slate-800 rounded-[2.5rem] shadow-sm border dark:border-slate-700 animate-zoom-in">
                        <div class="w-20 h-20 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-6 text-4xl">
                            <i class="fa-solid fa-circle-check"></i>
                        </div>
                        <h2 class="text-2xl font-black text-slate-800 dark:text-white mb-2">Terima Kasih!</h2>
                        <p class="text-slate-500 dark:text-slate-400 max-w-xs mx-auto mb-8">Anda sudah menyelesaikan kuesioner peminatan ini. Data Anda telah tersimpan dengan aman.</p>
                        <button onclick="window.location.replace('portal-siswa.html')" class="px-8 py-3 bg-indigo-600 text-white font-bold rounded-2xl transition-all active:scale-95">Lihat Dashboard Portal</button>
                    </div>
                `;
                hideLayoutElements();
                return;
            }
        }

        // Load Weights & Aspects (SSOT)
        if (data?.weights) {
            activeWeights = {};
            for (const [key, val] of Object.entries(data.weights)) {
                activeWeights[key] = val / 100;
            }
            evaluatedAspects = Object.keys(data.weights);
        } else {
            // Default Fallback
            activeWeights = { 'Kemampuan': 0.45, 'Minat': 0.30, 'Prestasi': 0.10, 'Cita-cita': 0.05, 'Gaya Belajar': 0.10 };
            evaluatedAspects = Object.keys(activeWeights);
        }

        allQuestions = shuffleAndFilterQuestions([...(data?.items || [])], currentStudent.nis || currentStudent.uid);

        // Get all unique aspects from the current question bank (AFTER allQuestions is filled)
        availableAspects = [...new Set(allQuestions.map(q => q.aspek))];
        currentLayout = data.layout || "classic";
        
        renderQuestions();
        updateProgress();

    } catch (e) {
        console.error("Load Questions Error:", e);
        container.innerHTML = '<div class="p-8 text-center text-red-500 bg-white rounded-2xl border">Gagal memuat bank soal. Periksa koneksi Anda.</div>';
    }
}

function hideLayoutElements() {
    const profilCard = document.querySelector('main > div:first-child');
    if (profilCard) profilCard.classList.add('hidden');
    const introMsg = document.querySelector('main > div:nth-child(2)');
    if (introMsg) introMsg.classList.add('hidden');
}

function shuffleAndFilterQuestions(items, seedKey) {
    // 1. Buat seed angka dari string NIS/UID
    let seed = 0;
    const seedStr = String(seedKey || 'default');
    for (let i = 0; i < seedStr.length; i++) seed += seedStr.charCodeAt(i);

    // 2. Acak seluruh item secara global dulu (Seeded)
    const globallyShuffled = shuffleInternal([...items], seed);

    // 3. Pisahkan pertanyaan 'L' (Lingkungan) dan lainnya
    const questionsL = globallyShuffled.filter(q => String(q.kode).toUpperCase().startsWith('L'));
    const questionsOthers = globallyShuffled.filter(q => !String(q.kode).toUpperCase().startsWith('L'));

    // 4. Ambil 9 soal pertama dari kategori non-L (sudah teracak dari langkah 2)
    const first9 = questionsOthers.splice(0, 9);

    // 5. Gabungkan sisanya dan acak kembali (Seeded dengan offset agar beda)
    const theRest = shuffleInternal([...questionsOthers, ...questionsL], seed + 99);

    return [...first9, ...theRest];
}

function shuffleInternal(array, seed) {
    let m = array.length, t, i;
    while (m) {
        // LCG (Linear Congruential Generator) sederhana untuk seeded random
        seed = (seed * 9301 + 49297) % 233280;
        i = Math.floor((seed / 233280) * m--);
        t = array[m];
        array[m] = array[i];
        array[i] = t;
    }
    return array;
}

function renderQuestions() {
    const container = document.getElementById('questionnaire-container');
    
    if (currentLayout === 'focus') {
        const q = allQuestions[currentStep];
        const isAnswered = userResponses[q.kode] !== undefined;
        const isLast = currentStep === allQuestions.length - 1;
        const progress = ((currentStep + 1) / allQuestions.length) * 100;

        let frame = document.getElementById('focus-mode-frame');
        if (!frame) {
            container.innerHTML = `
                <div id="focus-mode-frame" class="fixed inset-0 z-[100] bg-slate-900/90 backdrop-blur-md flex flex-col items-center justify-center p-3 sm:p-4 md:p-6 fade-in">
                    
                    <!-- Student Identity (Outside Card - Super Compact Capsule Style) -->
                    <div class="mb-3 text-center animate-slide-down flex flex-col items-center">
                        <div class="inline-flex items-center gap-2 px-3.5 py-1.5 bg-white/10 dark:bg-slate-800/40 backdrop-blur-md rounded-full border border-white/10 shadow-sm">
                            <i class="fa-solid fa-user-circle text-indigo-300 text-xs"></i>
                            <h4 class="text-xs font-black text-white uppercase tracking-wider">${currentStudent.name}</h4>
                            <span class="text-white/20 text-xs">|</span>
                            <span class="text-[10px] font-bold text-indigo-200/80 tracking-wider">${currentStudent.nis || '-'}</span>
                        </div>
                    </div>

                    <div class="bg-white dark:bg-slate-800 rounded-[2rem] shadow-2xl w-full max-w-xl overflow-hidden animate-zoom-in relative flex flex-col max-h-[80vh] md:max-h-[85vh]">
                        <!-- Top Progress Mini -->
                        <div class="absolute top-0 left-0 right-0 h-1.5 bg-slate-100 dark:bg-slate-700">
                            <div id="focus-progress-bar" class="h-full bg-indigo-500 transition-all duration-500" style="width: ${progress}%"></div>
                        </div>

                        <!-- Card Header (Fixed) -->
                        <div class="px-6 pt-6 pb-3 flex justify-between items-center border-b border-slate-50 dark:border-slate-700/50">
                            <span id="focus-step-text" class="px-2.5 py-1 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-lg font-black text-[9px] md:text-[10px] uppercase tracking-widest">Soal ${currentStep + 1} / ${allQuestions.length}</span>
                            <div id="focus-ans-indicator" class="w-2 h-2 rounded-full ${isAnswered ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}"></div>
                        </div>

                        <!-- Content Area (Scrollable if needed, flex-1 to occupy space) -->
                        <div class="p-6 md:p-8 overflow-y-auto flex-1 custom-scrollbar min-h-0">
                            <div id="focus-content-anim" class="fade-in flex flex-col justify-center h-full min-h-[160px] md:min-h-[200px]">
                                <h3 id="focus-q-text" class="text-lg md:text-xl font-bold text-slate-800 dark:text-white leading-snug mb-6 md:mb-8 text-center">${window.escapeHTML(q.teks)}</h3>
                                <div id="focus-options-container" class="grid grid-cols-5 gap-1.5 md:gap-3">
                                    ${renderOption(currentStep, q.kode, 5, 'Sangat Sesuai', 'fa-laugh-beam', 'text-emerald-500')}
                                    ${renderOption(currentStep, q.kode, 4, 'Sesuai', 'fa-smile', 'text-green-500')}
                                    ${renderOption(currentStep, q.kode, 3, 'Ragu-Ragu', 'fa-meh', 'text-gradient-ragu')}
                                    ${renderOption(currentStep, q.kode, 2, 'Tidak Sesuai', 'fa-frown', 'text-orange-500')}
                                    ${renderOption(currentStep, q.kode, 1, 'Sangat Tidak Sesuai', 'fa-angry', 'text-red-500')}
                                </div>
                            </div>
                        </div>

                        <!-- Footer Nav (Fixed at Bottom) -->
                        <div class="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/30">
                            <button id="btn-focus-prev" onclick="window.prevStep()" class="${currentStep === 0 ? 'invisible' : ''} flex items-center gap-1.5 text-xs md:text-sm font-bold text-slate-600 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 transition-all">
                                <i class="fa-solid fa-chevron-left"></i> Sebelumnya
                            </button>
                            
                            <div id="focus-nav-right">
                                ${isLast ? `
                                    <button id="btn-focus-next" ${!isAnswered ? 'disabled' : ''} onclick="window.closeFocusMode()" class="px-6 py-2.5 md:px-8 md:py-3 ${isAnswered ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200 dark:shadow-none' : 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed'} text-xs md:text-sm font-bold rounded-xl hover:scale-105 active:scale-95 transition-all">
                                        Selesai & Kirim <i class="fa-solid fa-flag-checkered ml-2"></i>
                                    </button>
                                ` : `
                                    <button id="btn-focus-next" ${!isAnswered ? 'disabled' : ''} onclick="window.nextStep()" class="flex items-center gap-1.5 text-xs md:text-sm font-bold ${isAnswered ? 'text-indigo-600 dark:text-indigo-400 hover:translate-x-1' : 'text-slate-300 dark:text-slate-600 cursor-not-allowed'} transition-all">
                                        Selanjutnya <i class="fa-solid fa-chevron-right"></i>
                                    </button>
                                `}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            // Update dynamic parts only
            document.getElementById('focus-progress-bar').style.width = `${progress}%`;
            document.getElementById('focus-step-text').innerText = `Soal ${currentStep + 1} / ${allQuestions.length}`;
            document.getElementById('focus-ans-indicator').className = `w-2 h-2 rounded-full ${isAnswered ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`;
            
            const anim = document.getElementById('focus-content-anim');
            anim.classList.remove('fade-in');
            void anim.offsetWidth; // Trigger reflow
            anim.classList.add('fade-in');

            document.getElementById('focus-q-text').innerText = q.teks;
            document.getElementById('focus-options-container').innerHTML = `
                ${renderOption(currentStep, q.kode, 5, 'Sangat Sesuai', 'fa-laugh-beam', 'text-emerald-500')}
                ${renderOption(currentStep, q.kode, 4, 'Sesuai', 'fa-smile', 'text-green-500')}
                ${renderOption(currentStep, q.kode, 3, 'Ragu-Ragu', 'fa-meh', 'text-gradient-ragu')}
                ${renderOption(currentStep, q.kode, 2, 'Tidak Sesuai', 'fa-frown', 'text-orange-500')}
                ${renderOption(currentStep, q.kode, 1, 'Sangat Tidak Sesuai', 'fa-angry', 'text-red-500')}
            `;

            document.getElementById('btn-focus-prev').className = `${currentStep === 0 ? 'invisible' : ''} flex items-center gap-1.5 text-xs md:text-sm font-bold text-slate-600 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 transition-all`;
            
            const nextBtnArea = document.getElementById('focus-nav-right');
            nextBtnArea.innerHTML = isLast ? `
                <button id="btn-focus-next" ${!isAnswered ? 'disabled' : ''} onclick="window.closeFocusMode()" class="px-6 py-2.5 md:px-8 md:py-3 ${isAnswered ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200 dark:shadow-none' : 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed'} text-xs md:text-sm font-bold rounded-xl hover:scale-105 active:scale-95 transition-all">
                    Selesai & Kirim <i class="fa-solid fa-flag-checkered ml-2"></i>
                </button>
            ` : `
                <button id="btn-focus-next" ${!isAnswered ? 'disabled' : ''} onclick="window.nextStep()" class="flex items-center gap-1.5 text-xs md:text-sm font-bold ${isAnswered ? 'text-indigo-600 dark:text-indigo-400 hover:translate-x-1' : 'text-slate-300 dark:text-slate-600 cursor-not-allowed'} transition-all">
                    Selanjutnya <i class="fa-solid fa-chevron-right"></i>
                </button>
            `;
        }
    } else {
        let html = '';
        allQuestions.forEach((q, index) => {
            html += `
                <div class="question-card fade-in mb-4" id="q-wrapper-${index}">
                    <div class="flex items-start gap-3 mb-4">
                        <span class="flex-shrink-0 w-8 h-8 bg-slate-100 text-slate-600 rounded-lg flex items-center justify-center font-bold text-xs border border-slate-200">${index + 1}</span>
                        <h3 class="text-sm md:text-base font-bold text-slate-700 leading-relaxed">${window.escapeHTML(q.teks)}</h3>
                    </div>
                    <div class="grid grid-cols-5 gap-1 md:gap-3">
                        ${renderOption(index, q.kode, 5, 'Sangat Sesuai', 'fa-laugh-beam', 'text-emerald-500')}
                        ${renderOption(index, q.kode, 4, 'Sesuai', 'fa-smile', 'text-green-500')}
                        ${renderOption(index, q.kode, 3, 'Ragu-Ragu', 'fa-meh', 'text-gradient-ragu')}
                        ${renderOption(index, q.kode, 2, 'Tidak Sesuai', 'fa-frown', 'text-orange-500')}
                        ${renderOption(index, q.kode, 1, 'Sangat Tidak Sesuai', 'fa-angry', 'text-red-500')}
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;
    }
}

window.nextStep = () => {
    if (currentStep < allQuestions.length - 1) {
        currentStep++;
        renderQuestions();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
};

window.prevStep = () => {
    if (currentStep > 0) {
        currentStep--;
        renderQuestions();
    }
};

window.closeFocusMode = () => {
    currentLayout = 'classic'; // Switch to list view for final check
    renderQuestions();
    updateProgress();
    // Scroll to submit button
    document.getElementById('btn-submit-peminatan').scrollIntoView({ behavior: 'smooth' });
};

function renderOption(stepIdx, kode, val, label, icon, colorClass) {
    const isChecked = userResponses[kode] == val;
    return `
        <label class="relative block">
            <input type="radio" name="resp-${kode}" value="${val}" ${isChecked ? 'checked' : ''} class="peer hidden" onchange="window.handleResponse('${kode}', ${val}, ${stepIdx})">
            <div class="radio-tile h-full text-center group peer-checked:border-indigo-500 peer-checked:bg-white peer-checked:text-indigo-600 peer-checked:ring-4 peer-checked:ring-indigo-500/10 peer-checked:scale-[0.95]">
                <i class="fa-solid ${icon} ${colorClass} text-base md:text-xl mb-1 group-hover:scale-110 transition-transform"></i>
                <span class="text-[7px] md:text-[10px] font-bold text-slate-500 leading-none block h-5 flex items-center justify-center">${label}</span>
            </div>
        </label>
    `;
}

window.handleResponse = (kode, val, stepIdx) => {
    userResponses[kode] = val;
    updateProgress();

    // Enable Next Button in Focus Mode
    if (currentLayout === 'focus') {
        const btnNext = document.getElementById('btn-focus-next');
        const isLast = currentStep === allQuestions.length - 1;
        if (btnNext) {
            btnNext.disabled = false;
            if (isLast) {
                btnNext.className = "px-6 py-2.5 md:px-8 md:py-3 bg-indigo-600 text-white shadow-lg shadow-indigo-200 dark:shadow-none text-xs md:text-sm font-bold rounded-xl hover:scale-105 active:scale-95 transition-all";
            } else {
                btnNext.className = "flex items-center gap-1.5 text-xs md:text-sm font-bold text-indigo-600 dark:text-indigo-400 hover:translate-x-1 transition-all";
            }
        }
        // Update Dot indicator
        const dot = document.getElementById('focus-ans-indicator');
        if (dot) dot.className = "w-2 h-2 rounded-full bg-emerald-500";
    }

    // Auto Advance in Focus Mode
    if (currentLayout === 'focus') {
        setTimeout(() => {
            if (stepIdx === currentStep) window.nextStep();
        }, 400);
    }
};

function updateProgress() {
    const total = allQuestions.length;
    const answered = Object.keys(userResponses).length;
    const percent = (answered / total) * 100;

    document.getElementById('progress-bar').style.width = `${percent}%`;
    document.getElementById('progress-text').innerText = `${answered} / ${total} Soal`;

    const btn = document.getElementById('btn-submit-peminatan');
    if (answered === total && currentStudent.isStudent) {
        btn.disabled = false;
        btn.classList.remove('bg-slate-300', 'dark:bg-slate-700', 'text-slate-500', 'dark:text-slate-400', 'cursor-not-allowed');
        btn.classList.add('bg-indigo-600', 'hover:bg-indigo-700', 'text-white', 'shadow-xl', 'shadow-indigo-200', 'dark:shadow-none', 'active:scale-95');
        document.getElementById('validation-msg').classList.add('hidden');
    } else if (answered === total && !currentStudent.isStudent) {
        document.getElementById('validation-msg').innerText = "Mode Preview: Admin tidak dapat mengirim jawaban.";
        document.getElementById('validation-msg').classList.remove('hidden');
    }
};

document.getElementById('btn-submit-peminatan').onclick = () => {
    if (Object.keys(userResponses).length < allQuestions.length) {
        document.getElementById('validation-msg').classList.remove('hidden');
        return;
    }
    document.getElementById('modal-confirm-submit').classList.remove('hidden');
};

window.processFinalSubmission = async () => {
    const modalConfirm = document.getElementById('modal-confirm-submit');
    const btn = modalConfirm.querySelector('button');
    const oldText = btn.innerText;
    
    btn.disabled = true;
    btn.innerText = 'Menghitung Hasil...';

    try {
        const result = calculateScores();
        
        const activeYearDoc = new Date().getFullYear().toString();
        const payload = {
            year: activeYearDoc,
            ta: currentTA,
            nis: currentStudent.nis,
            name: currentStudent.name,
            class: currentStudent.class,
            responses: userResponses,
            scores: result.scores,
            recommendation: result.recommendation,
            submitted_at: new Date().toISOString()
        };

        await cfClient.submitPeminatanResponse(payload);

        // Sembunyikan Hasil Langsung (Ganti dengan Popup Sukses)
        modalConfirm.classList.add('hidden');
        const container = document.getElementById('questionnaire-container');
        container.innerHTML = `
            <div class="py-20 px-8 text-center bg-white dark:bg-slate-800 rounded-[2.5rem] shadow-sm border dark:border-slate-700 animate-zoom-in">
                <div class="w-20 h-20 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-6 text-4xl">
                    <i class="fa-solid fa-circle-check"></i>
                </div>
                <h2 class="text-2xl font-black text-slate-800 dark:text-white mb-2">Jawaban Terkirim!</h2>
                <p class="text-slate-500 dark:text-slate-400 max-w-xs mx-auto mb-8">Terima kasih telah mengisi kuesioner peminatan ini dengan jujur. Data Anda telah kami simpan untuk proses analisis lebih lanjut.</p>
                <button onclick="window.location.replace('portal-siswa.html')" class="px-8 py-3 bg-indigo-600 text-white font-bold rounded-2xl transition-all active:scale-95">Kembali ke Portal</button>
            </div>
        `;
        hideLayoutElements();
        window.scrollTo({ top: 0, behavior: 'smooth' });

    } catch (e) {
        console.error("Submit Error:", e);
        showToast("Error", "Gagal menyimpan jawaban. Coba lagi.", "error");
        btn.disabled = false;
        btn.innerText = oldText;
    }
};

function calculateScores() {
    const weights = activeWeights;
    const categories = ['IPA', 'IPS', 'Bahasa'];
    const aspects = availableAspects;
    const evaluatableAspects = evaluatedAspects;
    
    // Inisialisasi Score
    let totals = {}; 
    categories.forEach(cat => {
        totals[cat] = {};
        aspects.forEach(asp => totals[cat][asp] = { sum: 0, count: 0 });
    });

    allQuestions.forEach(q => {
        const resp = userResponses[q.kode];
        if (resp === undefined) return;
        
        let score = resp;
        if (q.sifat === 'Negatif') score = 6 - resp;

        const normalized = (score / 5) * 100;

        if (totals[q.jurusan] && totals[q.jurusan][q.aspek]) {
            totals[q.jurusan][q.aspek].sum += normalized;
            totals[q.jurusan][q.aspek].count += 1;
        }
    });

    // Final Weighted Score per Jurusan
    let finalScores = {};
    let weightedResults = {};

    categories.forEach(cat => {
        weightedResults[cat] = {};
        let weightedSum = 0;
        
        aspects.forEach(asp => {
            const avg = totals[cat][asp].count > 0 ? (totals[cat][asp].sum / totals[cat][asp].count) : 0;
            weightedResults[cat][asp] = avg;
            
            // Hanya hitung bobot untuk aspek yang dievaluasi
            if (evaluatableAspects.includes(asp)) {
                weightedSum += avg * (weights[asp] || 0);
            }
        });

        weightedResults[cat].Total = weightedSum;
        finalScores[cat] = weightedSum;
    });

    // Cari Jurusan Tertinggi
    let recommendation = 'IPA';
    let maxScore = -1;
    
    for (const [cat, score] of Object.entries(finalScores)) {
        if (score > maxScore) {
            maxScore = score;
            recommendation = cat;
        }
    }

    return {
        scores: weightedResults,
        recommendation: recommendation
    };
}
