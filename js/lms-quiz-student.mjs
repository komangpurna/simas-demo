import { quizEscape, quizQuestionMarkup, quizAnswerLabel } from './lms-quiz-ui.mjs';
import { renderSafeMarkdown } from './utils.mjs';
import { getLmsScheduleState } from './lms-schedule.mjs';

export function installStudentQuiz({ api, getMaterial, getStudentId, onResult, notify }) {
    let state = null;
    let opening = 0;
    const el = id => document.getElementById(id);
    const show = (id, visible) => el(id)?.classList.toggle('hidden', !visible);
    const hint = text => {
        let node = el('student-quiz-save-status');
        if (!node) {
            node = document.createElement('p');
            node.id = 'student-quiz-save-status';
            node.className = 'text-xs text-slate-500 dark:text-slate-400';
            node.setAttribute('role', 'status');
            el('student-quiz-taking-section')?.prepend(node);
        }
        node.textContent = text;
    };
    const key = s => `simas.quiz.${getStudentId()}.${s.attempt.id}`;
    const signature = answers => JSON.stringify(Object.entries(answers).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
        .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
    function backup(s) {
        try { localStorage.setItem(key(s), JSON.stringify({ revision: s.attempt.revision, answers: s.answers, pending_signatures: s.pendingSignatures || [] })); return true; }
        catch (_) { return false; }
    }
    function markChanged() {
        const s = state;
        if (!s || s.busy || s.attempt.status !== 'in_progress' || s.attempt.is_locked) return;
        hint(backup(s) ? 'Jawaban dicadangkan di perangkat; menunggu simpan ke server.' : 'Jawaban belum tersimpan. Tetap buka halaman sampai tersimpan ke server.');
        clearTimeout(s.debounce);
        s.debounce = setTimeout(() => void save(s), 4000);
        updateNavigation();
    }
    async function save(s) {
        if (!s || s.busy || s.attempt.status !== 'in_progress' || s.attempt.is_locked || s.expired || s.conflict) return;
        if (s.saving) return s.saving;
        const snapshot = { ...s.answers };
        const sent = signature(snapshot);
        if (sent === s.savedSignature) return;
        s.pendingSignatures = [...new Set([...(s.pendingSignatures || []), sent])].slice(-10);
        backup(s);
        s.saving = (async () => {
            try {
                const response = await api.save({ material_id: s.material.id, attempt_id: s.attempt.id, revision: s.attempt.revision, answers: snapshot });
                s.attempt.revision = response.revision;
                s.savedSignature = sent;
                s.pendingSignatures = [];
                backup(s);
                if (state === s) hint(signature(s.answers) === sent ? 'Jawaban tersimpan di server.' : 'Jawaban terbaru sedang menunggu disimpan.');
            } catch (error) {
                if (/terkunci/i.test(error.message)) {
                    s.attempt.is_locked = 1;
                    s.attempt.lock_reason = error.message;
                    lockedMode(s);
                    return;
                }
                if (/sesi lain|telah berubah|versi terbaru/i.test(error.message)) s.conflict = true;
                if (state === s) hint(`Belum tersimpan ke server: ${error.message}`);
            } finally { s.saving = null; }
        })();
        return s.saving;
    }
    function stop(s) {
        if (s) {
            clearInterval(s.timer);
            clearInterval(s.autosave);
            clearTimeout(s.debounce);
            if (typeof s.cleanStrictListeners === 'function') s.cleanStrictListeners();
        }
    }
    function updateNavigation() {
        const s = state;
        if (!s) return;
        const questions = s.attempt.quiz.questions;
        const answered = q => s.answers[q.id] !== undefined && String(s.answers[q.id]).trim() !== '';
        const count = questions.filter(answered).length;
        el('student-quiz-progress-bar').style.width = `${Math.round(count / questions.length * 100)}%`;
        el('student-quiz-answered-count-text').textContent = `${count}/${questions.length} terjawab`;
        el('student-quiz-q-indicator').textContent = `Soal ${s.index + 1} dari ${questions.length}`;
        el('student-quiz-nav-pills').innerHTML = questions.map((q, i) => `<button type="button" data-quiz-index="${i}" aria-label="Soal ${i + 1}, ${answered(q) ? 'sudah' : 'belum'} dijawab" aria-current="${i === s.index ? 'step' : 'false'}" class="w-9 h-9 rounded-lg shrink-0 border text-xs font-bold ${i === s.index ? 'bg-purple-600 text-white' : answered(q) ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}">${i + 1}</button>`).join('');
        el('student-quiz-nav-pills').querySelectorAll('button').forEach(button => { button.onclick = () => window.jumpToStudentQuizQuestion(Number(button.dataset.quizIndex)); });
        el('btn-quiz-prev').disabled = s.index === 0;
        show('btn-quiz-next', s.index < questions.length - 1);
    }
    function renderQuestion() {
        const s = state;
        if (!s) return;
        const q = s.attempt.quiz.questions[s.index];
        updateNavigation();
        const qDescEl = el('student-quiz-question-desc-text');
        if (qDescEl) {
            qDescEl.textContent = s.attempt.quiz.mode === 'strict' ? 'Ujian CBT (Ketat)' : 'Asesmen Formatif';
        }
        el('student-quiz-question-type-badge').textContent = `${{ mc: 'Pilihan ganda (A–E)', short: 'Isian singkat', essay: 'Uraian · diperiksa guru' }[q.type] || 'Soal'} · ${q.points} poin`;
        el('student-quiz-question-text').innerHTML = quizQuestionMarkup(q);
        const container = el('student-quiz-answer-container');
        container.classList.add('text-slate-800', 'dark:text-slate-200');
        const locked = s.busy || s.expired || s.conflict || s.attempt.is_locked;
        if (q.type === 'mc') {
            container.innerHTML = `<fieldset class="space-y-2" ${locked ? 'disabled' : ''}><legend class="sr-only">Pilih satu jawaban</legend>${q.options.map((option, i) => `<label class="flex items-start gap-3 border dark:border-slate-700 rounded-xl p-3 cursor-pointer ${s.answers[q.id] === i ? 'bg-purple-50 dark:bg-purple-950 border-purple-500' : ''}"><input type="radio" name="student-quiz-option" value="${i}" class="mt-1" ${s.answers[q.id] === i ? 'checked' : ''}><span class="text-sm break-words">${String.fromCharCode(65 + i)}. ${renderSafeMarkdown(option)}</span></label>`).join('')}</fieldset>`;
            container.querySelectorAll('input').forEach(input => { input.onchange = () => { s.answers[q.id] = Number(input.value); markChanged(); renderQuestion(); }; });
        } else {
            container.innerHTML = `<label class="block text-sm font-medium">${q.type === 'essay' ? 'Tuliskan jawaban dan alasanmu' : 'Tuliskan jawaban singkat'}<textarea id="student-quiz-answer" rows="${q.type === 'essay' ? 6 : 2}" maxlength="${q.type === 'essay' ? 10000 : 2000}" class="mt-2 w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100" ${locked ? 'disabled' : ''}>${quizEscape(s.answers[q.id] || '')}</textarea></label><p class="text-xs text-slate-500">${q.type === 'essay' ? 'Guru akan memberi nilai dan umpan balik setelah dikumpulkan.' : 'Jawaban dinilai otomatis jika tersedia kunci, atau diperiksa guru. Pada penilaian otomatis, huruf besar/kecil dan spasi berlebih diabaikan.'}</p>`;
            el('student-quiz-answer').oninput = event => { s.answers[q.id] = event.target.value; markChanged(); };
        }
    }
    function showViolationModal(s, count, max, duration) {
        show('modal-student-quiz-violation', true);
        const effectiveMax = Number(max || s?.attempt?.quiz?.max_violations || 3);
        const currentCount = Number(count || 1);
        const descEl = el('student-quiz-violation-desc');
        if (descEl) descEl.innerHTML = `Anda terdeteksi meninggalkan layar kuis selama <b>${duration} detik</b>.`;
        const pillEl = el('student-quiz-violation-pill');
        if (pillEl) pillEl.textContent = `Pelanggaran: ${currentCount} dari ${effectiveMax}`;
        const curEl = el('student-quiz-violation-current');
        if (curEl) curEl.textContent = String(currentCount);
        const maxEl = el('student-quiz-violation-max');
        if (maxEl) maxEl.textContent = String(effectiveMax);
        const limitEl = el('student-quiz-violation-limit-text');
        if (limitEl) limitEl.textContent = String(effectiveMax);
        const btnAck = el('btn-student-quiz-ack-violation');
        if (btnAck) {
            btnAck.onclick = () => {
                show('modal-student-quiz-violation', false);
                if (document.fullscreenEnabled && !document.fullscreenElement) {
                    document.documentElement.requestFullscreen().catch(() => {});
                }
            };
        }
    }
    function lockedMode(s) {
        stop(s);
        show('student-quiz-taking-section', false);
        show('student-quiz-result-section', false);
        show('student-quiz-locked-section', true);
        show('student-quiz-footer-taking', false);
        show('student-quiz-footer-result', false);
        show('student-quiz-timer-badge', false);
        const reasonEl = el('student-quiz-locked-reason');
        if (reasonEl) reasonEl.textContent = s.attempt.lock_reason || 'Pengerjaan kuis Anda terkunci karena telah melebihi batas toleransi pelanggaran kuis CBT.';
        const countEl = el('student-quiz-locked-violation-badge');
        if (countEl) countEl.textContent = `Total Pelanggaran: ${s.attempt.violation_count || s.attempt.quiz.max_violations || 3} kali keluar layar`;
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
    function resultMode(s) {
        stop(s);
        const result = s.attempt.result;
        const pending = s.attempt.status === 'pending_review';
        el('student-quiz-q-indicator').textContent = `Hasil kuis · ${s.attempt.quiz.questions.length} soal`;
        show('student-quiz-taking-section', false); show('student-quiz-result-section', true);
        show('student-quiz-locked-section', false);
        show('student-quiz-footer-taking', false); show('student-quiz-footer-result', true); show('student-quiz-timer-badge', false);
        show('btn-quiz-retake', !pending && Boolean(s.attempt.quiz.allow_retake));
        const tone = pending ? 'amber' : result.passed ? 'emerald' : 'rose';
        el('student-quiz-result-banner').className = `p-5 rounded-2xl text-center space-y-3 border border-${tone}-200 bg-${tone}-50 dark:bg-slate-800`;
        el('student-quiz-result-icon').innerHTML = `<i class="fa-solid ${pending ? 'fa-hourglass-half' : result.passed ? 'fa-circle-check' : 'fa-book-open'}"></i>`;
        el('student-quiz-result-title').textContent = pending ? 'Menunggu pemeriksaan guru' : result.passed ? 'Sudah memenuhi ketuntasan' : 'Perlu penguatan materi';
        el('student-quiz-result-subtitle').textContent = pending ? result.submitted_late ? 'Jawaban diterima setelah batas waktu. Jawaban tetap disimpan dan menunggu pemeriksaan guru.' : 'Jawaban sudah diterima. Nilai akhir tersedia setelah diperiksa guru.' : 'Baca hasil dan umpan balik setiap soal di bawah.';
        el('student-quiz-result-score').textContent = pending ? '—' : result.score;
        el('student-quiz-result-score').className = `text-3xl sm:text-4xl font-black ${pending ? 'text-slate-500' : result.passed ? 'text-emerald-600' : 'text-rose-600'}`;
        el('student-quiz-result-summary-text').textContent = pending ? 'Nilai akhir belum diterbitkan' : `${result.earned_points} / ${result.total_points} poin · Batas ketuntasan ${result.passing_grade}`;
        el('student-quiz-review-list').classList.add('text-slate-800', 'dark:text-slate-200');
        el('student-quiz-review-list').innerHTML = (result.review || []).map((q, i) => {
            const correct = q.type === 'mc' ? quizAnswerLabel(q, q.correct_option) : q.correct_answer;
            return `<article class="p-4 rounded-xl border dark:border-slate-700 space-y-3"><div class="flex justify-between gap-2"><b>Soal ${i + 1}</b><span class="text-xs">${pending ? 'Menunggu hasil' : `${q.earned_points} / ${q.points} poin`}</span></div>${quizQuestionMarkup(q)}<div class="p-3 bg-slate-100 dark:bg-slate-800 rounded-lg whitespace-pre-wrap text-sm"><b>Jawabanmu:</b><br>${renderSafeMarkdown(quizAnswerLabel(q, q.student_answer))}</div>${!pending && correct ? `<p class="text-sm whitespace-pre-wrap"><b>Kunci:</b> ${renderSafeMarkdown(correct)}</p>` : ''}${q.feedback ? `<p class="text-sm whitespace-pre-wrap"><b>Umpan balik guru:</b> ${renderSafeMarkdown(q.feedback)}</p>` : ''}${q.explanation ? `<div class="text-sm whitespace-pre-wrap"><b>Pembahasan:</b> ${renderSafeMarkdown(q.explanation)}</div>` : ''}</article>`;
        }).join('') || '<p>Rincian jawaban belum tersedia.</p>';
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
    function takingMode(s) {
        show('student-quiz-taking-section', true); show('student-quiz-result-section', false);
        show('student-quiz-locked-section', false);
        show('student-quiz-footer-taking', true); show('student-quiz-footer-result', false);
        el('btn-quiz-submit').disabled = false;
        el('btn-quiz-submit').textContent = 'Kirim jawaban';
        const quizEnd = Date.parse(s.attempt.expires_at);
        const isStrict = s.attempt?.quiz?.mode === 'strict' || s.material?.payload?.mode === 'strict' || Boolean(s.material?.payload?.anti_cheat?.enabled);
        const materialEnd = (isStrict && s.material?.due_date) ? Date.parse(s.material.due_date) : Infinity;
        const effectiveEnd = Math.min(
            Number.isFinite(quizEnd) ? quizEnd : Infinity,
            Number.isFinite(materialEnd) ? materialEnd : Infinity
        );
        show('student-quiz-timer-badge', Number.isFinite(effectiveEnd));
        renderQuestion();
        if (s.attempt?.quiz?.mode === 'strict') {
            hint('Mode CBT Aktif: Dilarang berpindah tab atau keluar layar penuh. Jawaban tersimpan otomatis.');
        } else {
            hint('Jawaban disimpan saat berpindah soal dan secara berkala.');
        }
        const tick = () => {
            if (!Number.isFinite(effectiveEnd) || state !== s) return;
            const now = Date.now() + s.clockOffset;
            if (window.expireStudentLmsQuiz(now)) {
                notify('Kuis Belum Tersedia', 'Kuis sedang tidak tersedia. Draf jawaban tetap dicadangkan di perangkat.', 'info');
                return;
            }
            const seconds = Math.max(0, Math.ceil((effectiveEnd - now) / 1000));
            el('student-quiz-timer-text').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
            if (!seconds && !s.expired) { s.expired = true; renderQuestion(); void window.submitStudentQuiz(true); }
        };
        s.timer = setInterval(tick, 1000);
        s.autosave = setInterval(() => void save(s), 20000);
        tick();

        // CBT Mode Anti-Cheat (Robust & Anti-False-Positive Protection)
        if (s.attempt.quiz.mode === 'strict') {
            s.takingStartedAt = Date.now();

            if (document.fullscreenEnabled && !document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => {});
            }
            const modalEl = el('modal-student-quiz');
            if (modalEl) modalEl.classList.add('select-none');

            const onBlurOrHidden = () => {
                if (!state || state !== s || s.attempt.status !== 'in_progress' || s.attempt.is_locked) return;
                // 1. Grace Period 10 detik pertama sejak kuis dibuka untuk penyesuaian fullscreen & izin browser
                if (s.takingStartedAt && (Date.now() - s.takingStartedAt < 10000)) return;
                // 2. Abaikan jika dokumen masih berstatus visible dan fokus masih di dalam jendela browser (anti-false-blur)
                if (document.visibilityState === 'visible' && typeof document.hasFocus === 'function' && document.hasFocus()) return;
                // 3. Abaikan jika modal pelanggaran sedang terbuka di layar (mencegah cascade ganda saat membaca modal)
                if (!el('modal-student-quiz-violation')?.classList.contains('hidden')) return;

                if (!s.leftAt) s.leftAt = Date.now();
            };
            const onFocusOrVisible = async () => {
                if (!state || state !== s || s.attempt.status !== 'in_progress' || s.attempt.is_locked || !s.leftAt) return;
                if (s.reportingViolation) return;

                const leftTime = s.leftAt;
                s.leftAt = 0; // Segera netralkan timestamp agar event susulan tidak memicu eksekusi ganda

                // Abaikan jika modal pelanggaran sedang terbuka di layar
                if (!el('modal-student-quiz-violation')?.classList.contains('hidden')) return;

                const duration = Math.max(1, Math.round((Date.now() - leftTime) / 1000));
                // Toleransi minimum: keluar di bawah 5 detik dianggap ketidaksengajaan (notifikasi OS/gestur jari)
                if (duration < 5) {
                    hint('Perhatian: Tetap berada di layar kuis!');
                    return;
                }
                s.reportingViolation = true;
                try {
                    const fn = api.violation || window.cfReportLmsQuizViolation;
                    const res = typeof fn === 'function' ? await fn({
                        material_id: s.material.id,
                        attempt_id: s.attempt.id,
                        revision: s.attempt.revision,
                        violation_type: 'tab_switch',
                        duration_seconds: duration
                    }) : { violation_count: (s.attempt.violation_count || 0) + 1, is_locked: (s.attempt.violation_count || 0) + 1 >= (s.attempt.quiz.max_violations || 3) };
                    if (res.revision) s.attempt.revision = res.revision;
                    s.attempt.violation_count = res.violation_count;
                    if (res.is_locked) {
                        s.attempt.is_locked = 1;
                        s.attempt.lock_reason = res.lock_reason || 'Melebihi batas toleransi pelanggaran kuis CBT';
                        lockedMode(s);
                    } else {
                        showViolationModal(s, res.violation_count, res.max_violations || s.attempt.quiz.max_violations || 3, duration);
                    }
                } catch (err) {
                    hint(`Peringatan pelanggaran: ${err.message}`);
                } finally {
                    s.reportingViolation = false;
                }
            };
            const onVisibilityChange = () => {
                if (document.visibilityState === 'hidden') onBlurOrHidden();
                else if (document.visibilityState === 'visible') onFocusOrVisible();
            };
            const onFullscreenChange = () => {
                if (!state || state !== s || s.attempt.status !== 'in_progress' || s.attempt.is_locked) return;
                if (!document.fullscreenElement) {
                    // Layar penuh terlepas: jika masih fokus di tab, jangan anggap kecurangan, melainkan beri instruksi ramah
                    if (document.visibilityState === 'visible' && typeof document.hasFocus === 'function' && document.hasFocus()) {
                        hint('Mode CBT mewajibkan Layar Penuh. Klik layar untuk kembali ke Layar Penuh.');
                    } else {
                        onBlurOrHidden();
                    }
                } else if (s.leftAt) {
                    onFocusOrVisible();
                }
            };

            window.addEventListener('blur', onBlurOrHidden);
            window.addEventListener('focus', onFocusOrVisible);
            document.addEventListener('visibilitychange', onVisibilityChange);
            document.addEventListener('fullscreenchange', onFullscreenChange);

            s.cleanStrictListeners = () => {
                window.removeEventListener('blur', onBlurOrHidden);
                window.removeEventListener('focus', onFocusOrVisible);
                document.removeEventListener('visibilitychange', onVisibilityChange);
                document.removeEventListener('fullscreenchange', onFullscreenChange);
                if (modalEl) modalEl.classList.remove('select-none');
            };
        }
    }
    window.openStudentQuiz = async (materialId, retake = false) => {
        if (state?.busy) return;
        const material = getMaterial(materialId);
        if (!material) return;
        if (material.is_locked) return notify('Kuis terkunci', material.unlock_reason || 'Selesaikan materi sebelumnya.', 'warning');
        const token = ++opening;
        const previous = state;
        stop(previous);
        await save(previous);
        if (token !== opening) return;
        show('modal-student-quiz', true);
        show('student-quiz-taking-section', true); show('student-quiz-result-section', false);
        show('student-quiz-locked-section', false);
        show('student-quiz-footer-taking', false); show('student-quiz-footer-result', false);
        el('student-quiz-title').textContent = material.title;
        el('student-quiz-subject').textContent = material.subject_name;
        el('student-quiz-question-text').textContent = 'Memuat pengerjaan kuis...';
        el('student-quiz-answer-container').innerHTML = '';
        try {
            const response = await api.start({ material_id: materialId, retake, previous_attempt_id: retake ? previous?.attempt.id : undefined });
            if (token !== opening) return;
            const attempt = response.attempt;
            if (!getLmsScheduleState(material, Date.parse(attempt.server_now) || Date.now()).isAccessible) {
                show('modal-student-quiz', false);
                return notify('Kuis Belum Tersedia', 'Materi belum tersedia untuk dikerjakan.', 'warning');
            }
            const s = { material, attempt, answers: { ...attempt.answers }, index: 0, clockOffset: Date.parse(attempt.server_now) - Date.now(), busy: false, savedSignature: signature(attempt.answers) };
            state = s;
            el('student-quiz-kkm-badge').textContent = `Ketuntasan: ${attempt.quiz.passing_grade} · ${attempt.quiz.mode === 'strict' ? 'CBT' : 'Kuis'}`;
            const modeBadge = el('student-quiz-mode-badge');
            if (modeBadge) {
                if (attempt.quiz.mode === 'strict') {
                    modeBadge.className = 'px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 font-extrabold flex items-center gap-1 border border-rose-200 dark:border-rose-800';
                    modeBadge.innerHTML = '<i class="fa-solid fa-shield-halved text-rose-600"></i><span>Mode CBT Anti-Kecurangan</span>';
                } else {
                    modeBadge.className = 'px-2 py-0.5 rounded-md bg-purple-100 text-purple-800 dark:bg-purple-950/80 dark:text-purple-300 font-extrabold flex items-center gap-1 border border-purple-200 dark:border-purple-800';
                    modeBadge.innerHTML = '<i class="fa-solid fa-circle-question text-purple-600"></i><span>Kuis Formatif Santai</span>';
                }
            }
            if (attempt.status !== 'in_progress') {
                resultMode(s);
                Promise.resolve().then(() => onResult(material, attempt)).catch(() => {});
                return;
            }
            if (attempt.is_locked) {
                lockedMode(s);
                return;
            }
            try {
                const local = JSON.parse(localStorage.getItem(key(s)) || 'null');
                const sameRevision = local?.revision === attempt.revision;
                const ownSaveAcknowledged = local?.revision + 1 === attempt.revision && Array.isArray(local.pending_signatures)
                    && local.pending_signatures.includes(signature(attempt.answers));
                if ((sameRevision || ownSaveAcknowledged) && local.answers && typeof local.answers === 'object' && !Array.isArray(local.answers)) {
                    s.answers = local.answers;
                    if (sameRevision) s.pendingSignatures = local.pending_signatures || [];
                }
            } catch (_) { /* Storage may be disabled. Server draft remains available. */ }
            takingMode(s);
        } catch (error) { if (token === opening) { hint(error.message); el('student-quiz-question-text').textContent = 'Kuis belum dapat dibuka. Tutup lalu coba lagi.'; } }
    };
    window.jumpToStudentQuizQuestion = index => {
        if (!state || index < 0 || index >= state.attempt.quiz.questions.length) return;
        void save(state);
        state.index = index;
        renderQuestion();
    };
    window.navStudentQuizQuestion = direction => window.jumpToStudentQuizQuestion((state?.index || 0) + direction);
    window.submitStudentQuiz = async (automatic = false) => {
        const s = state;
        if (!s || s.busy || s.attempt.status !== 'in_progress' || s.attempt.is_locked) return;
        if (s.conflict) { hint('Jawaban telah berubah di sesi lain. Tutup dan buka kembali kuis.'); return; }
        const missing = s.attempt.quiz.questions.filter(q => s.answers[q.id] === undefined || String(s.answers[q.id]).trim() === '').length;
        if (!automatic && !window.confirm(missing ? `${missing} soal belum dijawab. Tetap kirim jawaban?` : 'Kirim jawaban sekarang? Jawaban yang dikumpulkan tidak dapat diubah.')) return;
        s.busy = true;
        clearTimeout(s.debounce);
        backup(s);
        el('btn-quiz-submit').disabled = true;
        el('btn-quiz-submit').textContent = 'Mengirim jawaban...';
        renderQuestion();
        try {
            await s.saving;
            if (s.conflict) throw new Error('Jawaban berubah di sesi lain. Buka kembali kuis.');
            const response = await api.submit({ material_id: s.material.id, attempt_id: s.attempt.id, revision: s.attempt.revision, answers: s.answers });
            s.attempt = response.attempt;
            try { localStorage.removeItem(key(s)); } catch (_) {}
            if (state === s) resultMode(s);
            Promise.resolve(onResult(s.material, response.attempt)).catch(() => {});
        } catch (error) {
            hint(`Jawaban belum terkirim: ${error.message}. Isian tetap tersedia; coba kirim lagi.`);
            el('btn-quiz-submit').textContent = 'Coba kirim lagi';
        } finally { s.busy = false; el('btn-quiz-submit').disabled = false; if (s.attempt.status === 'in_progress') renderQuestion(); }
    };
    window.retakeStudentQuiz = () => {
        if (!state || !state.attempt.quiz.allow_retake || state.attempt.status !== 'graded') return;
        if (window.confirm('Mulai pengerjaan baru? Hasil sebelumnya tetap tersimpan; hasil pengerjaan terbaru menjadi progres kuis.')) void window.openStudentQuiz(state.material.id, true);
    };
    window.expireStudentLmsQuiz = now => {
        if (!state || getLmsScheduleState(state.material, now).isAccessible) return false;
        if (state.attempt.status === 'in_progress') backup(state);
        ++opening;
        stop(state);
        state = null;
        show('modal-student-quiz', false);
        return true;
    };
    window.closeStudentQuizModal = window.confirmCloseStudentQuiz = () => {
        if (state?.busy) return;
        if (state?.attempt?.status === 'in_progress' && state?.attempt?.quiz?.mode === 'strict') {
            if (!window.confirm('Peringatan CBT: Pengerjaan Mode Ketat sedang berjalan. Jika Anda menutup tampilan, waktu pengerjaan tetap berjalan di server. Yakin ingin keluar?')) {
                return;
            }
        }
        ++opening;
        if (state?.attempt.status === 'in_progress') { backup(state); void save(state); }
        stop(state);
        show('modal-student-quiz', false);
        show('modal-student-quiz-violation', false);
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
    window.addEventListener('beforeunload', event => {
        if (state?.attempt.status === 'in_progress' && signature(state.answers) !== state.savedSignature) { backup(state); event.preventDefault(); event.returnValue = ''; }
    });
    return { getState: () => state };
}
