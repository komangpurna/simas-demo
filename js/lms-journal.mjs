import { renderLmsJournalEvidenceCard, formatLmsJournalDuration } from './lms-journal-evidence.mjs';

const escapeLmsJournal = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const journalIcon = name => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="4"/>',
    teacher: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m14-11 2 2 4-4"/><circle cx="9" cy="7" r="4"/>',
    journal: '<path d="m16 3 5 5-12 12H4v-5zm-3 3 5 5M4 3h5M2 7h5"/>',
    students: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>'
})[name]}</svg>`;
export const lmsJournalDateWita = (now = new Date()) => new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
const lmsJournalWorkloadSynced = result => Boolean(result?.success && result.matched && (!result.ignored || result.already_synced));
export function lmsJournalWorkloadMessage(result) {
    if (lmsJournalWorkloadSynced(result)) return 'Realisasi e-Kinerja berhasil disinkronkan.';
    return `Belum masuk e-Kinerja: ${result?.reason || result?.error || 'sinkronisasi belum berhasil. Jurnal tetap tersimpan.'}`;
}

export function installLmsJournal({ request, school = {}, scheduleSuggestions = async () => [], loadMotivations = async () => [], onSaved = () => {}, notify = text => host.console.warn(text) }, host = window) {
    const doc = host.document;
    let state = null, dialog = null, evidenceDialog = null, opening = 0;
    let motivationLoading = null, motivations = [], motivationBag = [];
    function prepareMotivations() {
        if (motivationLoading) return;
        // Prefetch while the teacher reviews the journal; saving never waits on optional copy.
        motivationLoading = Promise.resolve().then(loadMotivations).then(items => {
            motivations = Array.isArray(items) ? [...new Set(items.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean))] : [];
        }).catch(() => {});
    }
    function nextMotivation() {
        if (!motivationBag.length) motivationBag = [...motivations];
        return motivationBag.length ? motivationBag.splice(Math.floor(Math.random() * motivationBag.length), 1)[0]
            : 'Semangat terus, Bapak/Ibu! Di tangan Anda, peradaban masa depan sedang dibentuk.';
    }
    const field = name => dialog.querySelector(`[data-journal-field="${name}"]`);
    const node = name => dialog.querySelector(`[data-journal-node="${name}"]`);
    const saveLabel = () => state?.journalId ? 'Simpan Kehadiran' : 'Simpan Jurnal';
    function message(text, type = '') {
        node('message').textContent = text; node('message').className = `lms-journal-note ${type === 'error' ? 'lms-journal-error' : type === 'success' ? 'lms-journal-success' : ''}`;
        node('message').hidden = !text;
        node('save-hint').textContent = text || `Klik ${saveLabel()} untuk konfirmasi dan tanda tangan.`;
        node('save-hint').classList.toggle('lms-journal-feedback-error', type === 'error');
        node('sign-message').textContent = text; node('sign-message').hidden = !text;
    }
    function busy(value) {
        state.busy = value;
        dialog.querySelectorAll('button, input, select, textarea').forEach(element => { element.disabled = value; });
        if (!value) node('preview').disabled = state.blocked;
    }
    function invalidate() {
        if (!state || state.busy) return;
        state.dirty = true;
        if (node('confirmed')) node('confirmed').checked = false;
        if (state.preview) {
            message(`Isian berubah. Klik ${saveLabel()}; rekap dan dokumentasi akan diperbarui otomatis sebelum konfirmasi TTD.`);
            node('evidence-preview').dataset.stale = 'true';
            node('evidence-summary').textContent = `Pratinjau perlu diperbarui. Klik ${saveLabel()} untuk menyesuaikannya dengan isian terbaru.`;
        }
    }
    function close() {
        if (state?.busy) return;
        if (evidenceDialog?.open) evidenceDialog.close();
        opening++; dialog.close(); state = null;
    }
    function enlargeEvidence(saved = false) {
        const source = saved ? state.savedResult?.evidence_url : node('evidence-image').getAttribute('src');
        if (!source) return;
        if (!evidenceDialog) {
            evidenceDialog = doc.createElement('dialog'); evidenceDialog.className = 'lms-journal-evidence-dialog';
            evidenceDialog.setAttribute('aria-labelledby', 'lms-journal-evidence-title');
            evidenceDialog.innerHTML = `<div class="lms-journal-evidence-toolbar"><h2 id="lms-journal-evidence-title">Pratinjau dokumentasi seluruh siswa</h2><button type="button" data-evidence-fit>Sesuaikan layar</button><button type="button" data-evidence-original>Ukuran asli</button><button type="button" data-evidence-close>Tutup</button></div><p>Akumulasi durasi aktif pada materi. Geser untuk melihat seluruh tabel.</p><div class="lms-journal-evidence-viewport"><img alt="Dokumentasi LMS: seluruh siswa, status belajar, durasi aktif, dan presensi"></div>`;
            doc.body.appendChild(evidenceDialog);
            evidenceDialog.querySelector('[data-evidence-close]').addEventListener('click', () => evidenceDialog.close());
            evidenceDialog.querySelector('[data-evidence-fit]').addEventListener('click', () => evidenceDialog.classList.add('lms-journal-evidence-fit'));
            evidenceDialog.querySelector('[data-evidence-original]').addEventListener('click', () => evidenceDialog.classList.remove('lms-journal-evidence-fit'));
        }
        evidenceDialog.querySelector('#lms-journal-evidence-title').textContent = saved ? 'Bukti pembelajaran yang telah disahkan' : 'Pratinjau dokumentasi seluruh siswa';
        evidenceDialog.querySelector('img').src = source;
        evidenceDialog.classList.remove('lms-journal-evidence-fit');
        evidenceDialog.showModal();
    }
    function successImageUrl(raw, resolvePhoto = false) {
        if (!raw) return '';
        try {
            const value = resolvePhoto && typeof host.resolvePhotoUrl === 'function' ? host.resolvePhotoUrl(raw) : raw;
            const url = new URL(value, doc.baseURI);
            return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
        } catch { return ''; }
    }
    function renderSuccess(result) {
        const snapshot = state.preview.snapshot, synced = lmsJournalWorkloadSynced(result.workloadSync);
        state.savedResult = result;
        const teacherName = String(snapshot.guru || 'Pengajar');
        const initials = teacherName.split(/[\s,]+/).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase();
        const photo = successImageUrl(state.context?.scope.teacher_photo_url, true), logo = successImageUrl(school.logoPath);
        const shortSchool = school.schoolShortName || 'SIMAS';
        const check = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
        node('sign').hidden = true; node('editor').hidden = true; node('result').hidden = false;
        node('result').innerHTML = `<article class="lms-journal-success-card" data-journal-node="success-card" aria-labelledby="lms-journal-success-title">
            <div class="lms-journal-success-top"><div class="lms-journal-success-brand">${logo ? `<img src="${escapeLmsJournal(logo)}" alt="" width="20" height="20">` : ''}<span>${escapeLmsJournal(shortSchool)}<span class="lms-journal-success-brand-divider" aria-hidden="true">/</span>JURNAL</span></div><button type="button" class="lms-journal-success-close" data-journal-node="success-close" aria-label="Tutup jurnal"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></div>
            <div class="lms-journal-success-main">
                <div class="lms-journal-success-portrait"><div class="lms-journal-success-avatar" role="img" aria-label="Profil ${escapeLmsJournal(teacherName)}"><span aria-hidden="true">${escapeLmsJournal(initials)}</span>${photo ? `<img data-journal-node="success-photo" src="${escapeLmsJournal(photo)}" alt="Foto ${escapeLmsJournal(teacherName)}" width="88" height="88" referrerpolicy="no-referrer">` : ''}</div><span class="lms-journal-success-check">${check}</span></div>
                <h3 id="lms-journal-success-title" tabindex="-1">Tersimpan<span>.</span></h3><p id="lms-journal-success-description" class="lms-journal-success-tagline">Jurnal berhasil disimpan.<span class="lms-journal-success-source">${state.journalId ? 'Presensi diperbarui dari jurnal LMS tersimpan.' : "Tersinkron otomatis dari <strong>LMS SIMAS-CERDAS</strong>."}</span></p>
                <div class="lms-journal-success-teacher"><strong>${escapeLmsJournal(teacherName)}</strong><p>Kelas ${escapeLmsJournal(snapshot.kelas)}<span aria-hidden="true"> · </span>${escapeLmsJournal(snapshot.mapel)}</p></div>
                <div class="lms-journal-success-sync ${synced ? 'is-synced' : 'is-pending'}" data-journal-node="success-workload"><span class="lms-journal-success-sync-label">${synced ? check : '<span aria-hidden="true">ⓘ</span>'}${synced ? 'e-Kinerja tersinkron' : 'e-Kinerja belum tersinkron'}</span>${synced ? '' : `<p>${escapeLmsJournal(lmsJournalWorkloadMessage(result.workloadSync))}</p>`}</div>
                ${Number(result.revision) > 1 ? `<p class="lms-journal-success-revision">Revisi ${Number(result.revision)}</p>` : ''}
                <blockquote class="lms-journal-success-motivation" data-journal-node="success-motivation">“${escapeLmsJournal(nextMotivation())}”</blockquote>
                <div class="lms-journal-success-actions"><button type="button" class="lms-journal-button" data-journal-node="done">Selesai<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg></button><button type="button" class="lms-journal-button" data-journal-node="saved-evidence">Lihat bukti mengajar<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg></button></div>
            </div></article>
            <img class="lms-journal-evidence" src="${escapeLmsJournal(result.evidence_url)}" alt="Bukti pembelajaran LMS yang telah disahkan" hidden>`;
        const portrait = node('success-photo');
        portrait?.addEventListener('error', () => portrait.remove(), { once: true });
        node('result').querySelector('.lms-journal-success-brand img')?.addEventListener('error', event => event.target.remove(), { once: true });
        node('saved-evidence').addEventListener('click', () => enlargeEvidence(true)); node('done').addEventListener('click', close); node('success-close').addEventListener('click', close);
        dialog.setAttribute('aria-labelledby', 'lms-journal-success-title'); dialog.setAttribute('aria-describedby', 'lms-journal-success-description');
        dialog.classList.add('lms-journal-saved'); message(''); dialog.scrollTop = 0;
        doc.getElementById('lms-journal-success-title').focus({ preventScroll: true });
    }
    function buildDialog() {
        if (dialog) return;
        dialog = doc.createElement('dialog'); dialog.className = 'lms-journal-dialog';
        dialog.setAttribute('aria-labelledby', 'lms-journal-title');
        dialog.innerHTML = `<div class="lms-journal-head"><div><h2 id="lms-journal-title">Sinkron Jurnal Mengajar</h2><p data-journal-node="scope" class="lms-journal-subtitle"></p></div><button type="button" class="lms-journal-button" data-journal-node="close" aria-label="Tutup jurnal">Tutup</button></div>
            <div class="lms-journal-body"><p data-journal-node="message" class="lms-journal-note" hidden></p>
            <section data-journal-node="editor">
                <section class="lms-journal-card">
                    <div class="lms-journal-card-heading"><span class="lms-journal-icon lms-journal-pink">${journalIcon('camera')}</span><h3>Foto Dokumentasi</h3><span class="lms-journal-badge">Otomatis dari LMS</span></div>
                    <figure class="lms-journal-evidence-preview" data-journal-node="evidence-preview" hidden><div class="lms-journal-evidence-thumbnail"><img data-journal-node="evidence-image" alt="Pratinjau seluruh siswa, status belajar, durasi aktif, dan presensi, belum disahkan"></div><figcaption>Seluruh siswa · Status belajar · Akumulasi durasi aktif · Presensi</figcaption><button type="button" class="lms-journal-button" data-journal-node="evidence-open">Perbesar dokumentasi</button></figure>
                    <p class="lms-journal-help" data-journal-node="evidence-summary">Memuat pratinjau dokumentasi dari materi dan progres siswa…</p>
                </section>
                <section class="lms-journal-card">
                    <div class="lms-journal-card-heading"><span class="lms-journal-icon lms-journal-blue">${journalIcon('teacher')}</span><h3>Identitas Pengajar</h3></div>
                    <div class="lms-journal-grid">
                        <label class="lms-journal-field lms-journal-wide">Nama guru<input data-journal-node="teacher" readonly></label>
                        <label class="lms-journal-field">Kelas<input data-journal-node="class" readonly></label>
                        <label class="lms-journal-field">Mata pelajaran<input data-journal-node="subject" readonly></label>
                        <input type="hidden" data-journal-field="tanggal">
                        <div class="lms-journal-field lms-journal-wide">Pertemuan KBM<p class="lms-journal-help" data-journal-node="meeting"></p><input type="hidden" data-journal-field="plan_segment_id"></div>
                        <div class="lms-journal-field lms-journal-wide"><span id="lms-journal-jp-label">Jam Pelajaran (JP)</span><div class="lms-journal-jp" data-journal-node="jp-options" role="group" aria-labelledby="lms-journal-jp-label"></div><small class="lms-journal-help" data-journal-node="jp-summary"></small></div>
                        <input type="hidden" data-journal-field="schedule_note">
                    </div>
                    <div data-journal-node="settings" hidden><input type="hidden" data-journal-field="period_start"><input type="hidden" data-journal-field="period_end"><input type="hidden" data-journal-field="jp"><div data-journal-node="materials"></div></div>
                </section>
                <div data-journal-node="existing" class="lms-journal-note" hidden></div>
                <section class="lms-journal-card">
                    <div class="lms-journal-card-heading"><span class="lms-journal-icon lms-journal-purple">${journalIcon('journal')}</span><h3>Jurnal &amp; Validasi</h3></div>
                    <div class="lms-journal-stack">
                        <label class="lms-journal-field">Topik Hari Ini<input data-journal-field="topik" maxlength="2000" required></label>
                        <label class="lms-journal-field">Catatan (Opsional)<textarea data-journal-field="catatan" rows="3" maxlength="3500" placeholder="Catatan tambahan…"></textarea></label>
                    </div>
                    <div class="lms-journal-card-heading lms-journal-attendance-heading"><span class="lms-journal-icon lms-journal-green">${journalIcon('students')}</span><h3>Presensi Siswa</h3><button type="button" class="lms-journal-button" data-journal-node="preview">Perbarui rekap</button></div>
                    <p class="lms-journal-help" data-journal-node="attendance-help">Siswa dengan aktivitas LMS otomatis Hadir. Siswa tanpa progres silakan tentukan status presensinya secara manual.</p>
                    <p class="lms-journal-help" data-journal-node="attendance-empty">Presensi akan terisi otomatis setelah jadwal guru tersedia.</p>
                    <section data-journal-node="preview-content" hidden></section>
                </section>
                <div class="lms-journal-save-bar"><p data-journal-node="save-hint" role="status" aria-live="polite">Klik Simpan Jurnal untuk konfirmasi dan tanda tangan.</p><button type="button" class="lms-journal-button lms-journal-primary" data-journal-node="save">Simpan Jurnal</button></div>
            </section>
            <section class="lms-journal-card" data-journal-node="sign" hidden>
                <h3 class="lms-journal-field">Konfirmasi dan tanda tangan</h3><p data-journal-node="sign-summary" class="lms-journal-note"></p>
                <details class="lms-journal-sign-review"><summary>Periksa rincian presensi</summary><div data-journal-node="sign-attendance"></div></details>
                <label class="lms-journal-check"><input type="checkbox" data-journal-node="confirmed"><span data-journal-node="confirmation-label">Saya telah memeriksa isian, dokumentasi, dan seluruh presensi.</span></label>
                <p class="lms-journal-note lms-journal-error" data-journal-node="sign-message" role="status" aria-live="polite" hidden></p>
                <p>Gambar tanda tangan untuk mengesahkan isian, presensi, dan bukti LMS pada rekap ini.</p>
                <canvas width="600" height="220" class="lms-journal-signature" data-journal-node="canvas" aria-label="Area menggambar tanda tangan"></canvas>
                <div class="lms-journal-actions"><button type="button" class="lms-journal-button" data-journal-node="clear">Hapus TTD</button><button type="button" class="lms-journal-button" data-journal-node="back">Kembali periksa</button><button type="button" class="lms-journal-button lms-journal-primary" data-journal-node="commit">Konfirmasi dan simpan</button></div>
            </section><section data-journal-node="result" hidden></section></div>`;
        doc.body.appendChild(dialog);
        node('close').addEventListener('click', close);
        dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
        node('preview').addEventListener('click', () => preview(true));
        node('save').addEventListener('click', sign);
        node('commit').addEventListener('click', commit);
        node('evidence-open').addEventListener('click', () => enlargeEvidence(false));
        node('confirmed').addEventListener('change', () => { if (node('confirmed').checked) message(''); });
        node('back').addEventListener('click', () => { if (!state.busy) { node('sign').hidden = true; node('editor').hidden = false; node('save').focus(); } });
        node('clear').addEventListener('click', clearSignature);
        field('tanggal').addEventListener('change', () => { invalidate(); loadContext(true); });
        node('editor').addEventListener('input', event => {
            if (event.target === field('topik')) state.topikEdited = true;
            if (event.target === field('jp')) renderJp();
            if (event.target.matches('[data-material-id]') && !state.topikEdited) {
                const ids = [...node('materials').querySelectorAll('input:checked')].map(input => input.dataset.materialId);
                field('topik').value = state.context.materials.filter(material => ids.includes(material.id)).map(material => material.title).join('; ');
            }
            if (event.target.matches('[data-journal-field], [data-material-id]')) invalidate();
            if (event.target.matches('[data-attendance-status]')) {
                const row = event.target.closest('[data-student-nis]');
                state.overrides[row.dataset.studentNis] = { status: row.querySelector('select').value, reason: '' };
                row.dataset.status = row.querySelector('select').value;
                row.querySelector('select')?.classList.remove('is-unselected');
                invalidate();
            }
        });
        const canvas = node('canvas'); let pen = null;
        const position = event => { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height }; };
        canvas.addEventListener('pointerdown', event => {
            if (state.busy || (event.pointerType === 'mouse' && event.button !== 0)) return;
            event.preventDefault();
            try { canvas.setPointerCapture(event.pointerId); } catch { /* Keep drawing on devices without pointer capture. */ }
            pen = { ...position(event), id: event.pointerId };
        });
        canvas.addEventListener('pointermove', event => {
            if (!pen || pen.id !== event.pointerId || state.busy) return;
            const point = position(event), ctx = canvas.getContext('2d');
            ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.strokeStyle = '#0f172a'; ctx.beginPath(); ctx.moveTo(pen.x, pen.y); ctx.lineTo(point.x, point.y); ctx.stroke();
            state.ink += Math.hypot(point.x - pen.x, point.y - pen.y); pen = { ...point, id: pen.id };
        });
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, () => { pen = null; });
    }
    function clearSignature() { state.ink = 0; const canvas = node('canvas'); canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); }
    function selectedJp() {
        const value = field('jp').value.trim();
        const range = value.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
        return range && Number(range[1]) >= 1 && Number(range[2]) >= Number(range[1]) && Number(range[2]) <= 20
            ? Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, index) => Number(range[1]) + index)
            : [...new Set(value.split(',').map(Number).filter(jp => Number.isInteger(jp) && jp >= 1 && jp <= 20))];
    }
    function renderJp() {
        const selected = selectedJp();
        node('jp-options').innerHTML = selected.map(jp => `<span class="lms-journal-jp-number" data-journal-jp="${jp}">${jp}</span>`).join('');
        node('jp-summary').textContent = selected.length ? `${selected.length} jam pelajaran · ${state.journalId ? 'Sesuai jurnal tersimpan' : 'Otomatis sesuai jadwal guru'}` : 'JP belum tersedia pada jadwal guru.';
        const meeting = state.context?.meetings.find(item => item.id === field('plan_segment_id').value);
        node('meeting').textContent = meeting ? `${meeting.start_time}–${meeting.end_time} · ${meeting.plan_status === 'approved' ? 'Rencana disetujui' : 'Rencana belum disetujui'}${meeting.week_locked ? ' · Minggu terkunci' : ''}` : state.journalId ? 'Mengikuti pertemuan pada jurnal tersimpan.' : 'Mengikuti jadwal mengajar resmi.';
    }
    async function loadContext(reset = false) {
        const current = state, version = ++opening;
        state.preview = null; state.dirty = true; state.blocked = false; state.blockedReason = '';
        node('preview-content').hidden = true; node('evidence-preview').hidden = true;
        busy(true); message('Memuat pertemuan KBM dan jurnal yang sudah ada…');
        try {
            const data = current.entryContext || await request(`/api/lms/journal/context?${new URLSearchParams({ material_id: current.materialId, tanggal: field('tanggal').value })}`);
            if (state !== current || opening !== version) return;
            state.context = data; state.overrides = {};
            node('scope').textContent = `Jurnal Mengajar ${data.scope.class_name} · ${state.journalId ? 'Koreksi presensi dari jurnal tersimpan' : 'Terisi otomatis dari LMS'}`;
            node('teacher').value = data.scope.teacher_name; node('subject').value = data.scope.subject_name; node('class').value = data.scope.class_name;
            field('plan_segment_id').value = '';
            const saved = data.existing?.snapshot;
            field('schedule_note').value = '';
            const selectedIds = saved?.material_ids || [current.materialId];
            node('materials').innerHTML = data.materials.map(material => `<label><input type="checkbox" data-material-id="${escapeLmsJournal(material.id)}" ${selectedIds.includes(material.id) ? 'checked' : ''}>${escapeLmsJournal(material.title)}</label>`).join('');
            if (saved) {
                state.topikEdited = true;
                field('plan_segment_id').value = saved.plan_segment_id;
                for (const name of ['topik', 'catatan', 'period_start', 'period_end']) field(name).value = saved[name] || '';
                field('jp').value = saved.jp.join(',');
                for (const student of saved.students) if (student.source === 'koreksi_guru') state.overrides[student.nis] = { status: student.status, reason: student.reason };
            } else {
                state.topikEdited = false;
                if (reset) for (const name of ['jp', 'schedule_note', 'catatan']) field(name).value = '';
                field('period_start').value = field('tanggal').value; field('period_end').value = field('tanggal').value;
                field('topik').value = data.materials.find(material => material.id === current.materialId)?.title || '';
                if (!data.existing) {
                    let meeting = data.meetings.length === 1 ? data.meetings[0] : null;
                    const suggestions = meeting?.jp.length ? [] : await scheduleSuggestions(data.scope, field('tanggal').value).catch(() => []);
                    if (state !== current || opening !== version) return;
                    if (data.meetings.length > 1) {
                        const officialJp = [...new Set(suggestions.map(Number))].sort((a, b) => a - b).join(',');
                        const matches = data.meetings.filter(item => item.jp.length && [...item.jp].sort((a, b) => a - b).join(',') === officialJp);
                        if (matches.length !== 1) throw new Error('Ada beberapa pertemuan KBM yang belum dapat dicocokkan otomatis. Periksa kesesuaian rencana e-Kinerja dengan jadwal guru, lalu buka ulang sinkronisasi.');
                        meeting = matches[0];
                    }
                    const jp = meeting?.jp.length ? meeting.jp : suggestions;
                    if (!jp.length || (meeting && Number(meeting.jp_count) > 0 && Number(meeting.jp_count) !== jp.length)) throw new Error('JP belum dapat dicocokkan dengan jadwal guru hari ini. Periksa jadwal mengajar resmi, lalu buka ulang sinkronisasi.');
                    field('jp').value = jp.join(',');
                    if (meeting) field('plan_segment_id').value = meeting.id;
                    else field('schedule_note').value = 'Mengikuti jadwal mengajar resmi; pertemuan e-Kinerja belum ditautkan.';
                }
            }
            node('existing').hidden = !data.existing;
            node('existing').textContent = data.existing ? (saved ? `Jurnal revisi ${data.existing.revision} sudah tersimpan. Pembaruan memerlukan pemeriksaan dan TTD baru; bukti lama tetap tersimpan.` : 'Jurnal sudah ada dari pengisian sebelumnya. Periksa melalui tab Jurnal; entri ini tidak dapat ditimpa dari LMS.') : '';
            state.blocked = Boolean(data.existing && !saved);
            state.blockedReason = state.blocked ? node('existing').textContent : '';
            state.preview = null; state.dirty = true; node('preview-content').hidden = true; node('attendance-empty').hidden = false;
            renderJp();
            message(state.blocked ? state.blockedReason : 'Isian jurnal terisi otomatis. Periksa JP dan presensi sebelum menyimpan.', state.blocked ? 'error' : '');
        } catch (error) { if (state === current && opening === version) { state.blocked = true; state.blockedReason = error.message; renderJp(); message(error.message, 'error'); } }
        finally { if (state === current && opening === version) { busy(false); node('preview').disabled = state.blocked; } }
        if (state === current && opening === version && !state.blocked) {
            if (state.journalId || (field('jp').value && (field('plan_segment_id').value || field('schedule_note').value || field('catatan').value.includes('[Penyesuaian jadwal]')))) await preview();
            else message('Jadwal guru belum tersedia untuk sinkronisasi jurnal hari ini.', 'error');
        }
    }

    function payload() {
        if (state.journalId) return { journal_id: state.journalId, attendance_only: true,
            ...(state.refreshAttendance ? { refresh_attendance: true } : {}), overrides: JSON.parse(JSON.stringify(state.overrides)) };
        const materialIds = [...node('materials').querySelectorAll('input:checked')].map(input => input.dataset.materialId);
        if (!materialIds.length) throw new Error('Materi sumber jurnal tidak tersedia. Untuk mengoreksi presensi, buka Edit Kehadiran dari tab Jurnal.');
        const body = Object.fromEntries(['tanggal', 'plan_segment_id', 'jp', 'period_start', 'period_end', 'topik', 'catatan'].map(name => [name, field(name).value]));
        const note = field('schedule_note').value.trim();
        if (!body.plan_segment_id && !note && !body.catatan.includes('[Penyesuaian jadwal]')) throw new Error('Jadwal resmi belum tersedia untuk jurnal ini. Periksa jadwal guru, lalu buka ulang sinkronisasi.');
        if (note) body.catatan = `${body.catatan}\n[Penyesuaian jadwal] ${note}`.trim();
        return { ...body, material_ids: materialIds, overrides: JSON.parse(JSON.stringify(state.overrides)) };
    }
    async function preview(refreshAttendance = false) {
        if (state.busy || state.blocked) return false;
        if (refreshAttendance && state.journalId) state.refreshAttendance = true;
        busy(true); message(state.refreshAttendance ? 'Memperbarui kehadiran dan rekap dari aktivitas LMS…' : 'Mengambil rekap…');
        try {
            const body = payload(), data = await request('/api/lms/journal/preview', { method: 'POST', body: JSON.stringify(body) });
            state.preview = data; state.frozen = { ...body, snapshot_at: data.snapshot.snapshot_at,
                ...(data.learning_receipt ? { learning_receipt: data.learning_receipt } : {}) }; state.dirty = false;
            state.requestId = host.crypto.randomUUID();
            const snapshot = data.snapshot;
            const statuses = { H: 'Hadir', S: 'Sakit', I: 'Izin', A: 'Alfa', D: 'Dispen', T: 'Tugas' };
            const counts = snapshot.students.reduce((result, student) => {
                if (result[student.status] !== undefined) result[student.status]++;
                else result['unassigned'] = (result['unassigned'] || 0) + 1;
                return result;
            }, { H: 0, S: 0, I: 0, A: 0, D: 0, T: 0 });
            const unassignedCount = counts['unassigned'] || 0;
            node('preview-content').innerHTML = `<div class="lms-journal-presensi-summary"><strong>Hadir ${snapshot.summary.hadir}/${snapshot.summary.total}</strong><div>${unassignedCount > 0 ? `<span data-status="unassigned" class="lms-journal-unassigned-badge" title="Belum dipilih statusnya">Belum Diisi: ${unassignedCount}</span>` : ''}${Object.entries(statuses).map(([status, label]) => `<span data-status="${status}" title="${label}">${status}: ${counts[status]}</span>`).join('')}</div></div>
                ${data.history_note ? `<p class="lms-journal-note">${escapeLmsJournal(data.history_note)}</p>` : ''}
                <div class="lms-journal-students">${snapshot.students.map((student, index) => `<div class="lms-journal-student" data-student-nis="${escapeLmsJournal(student.nis)}" data-status="${escapeLmsJournal(student.status)}">
                    <span class="lms-journal-student-number">${index + 1}</span><div class="lms-journal-student-name"><strong>${escapeLmsJournal(student.nama)}</strong><small>${escapeLmsJournal(student.nis)} · ${student.has_progress ? 'Ada progres LMS' : 'Belum ada progres LMS'}</small>${snapshot.learning_version === 1 ? `<small>${({ completed: 'Selesai belajar', in_progress: 'Sedang belajar', not_opened: 'Belum membuka', activity_only: 'Ada aktivitas' })[student.learning_status] || 'Belum tercatat'} · Durasi aktif ${escapeLmsJournal(formatLmsJournalDuration(student.active_seconds))}</small>` : ''}</div>
                    <select data-attendance-status aria-label="Presensi ${escapeLmsJournal(student.nama)}" class="${!student.status ? 'is-unselected' : ''}">${!student.status ? '<option value="" selected disabled>-- Pilih Status --</option>' : ''}${Object.entries(statuses).map(([status, label]) => `<option value="${status}" ${status === student.status ? 'selected' : ''}>${label}</option>`).join('')}</select></div>`).join('')}</div>
                <p class="lms-journal-help">Pastikan seluruh status presensi siswa telah dipilih. Klik ${saveLabel()} untuk memperbarui rekap dan melanjutkan ke konfirmasi TTD.</p>
                <p class="lms-journal-help">${escapeLmsJournal(data.workload_hint)}</p>
                `;
            node('attendance-empty').hidden = true;
            node('evidence-summary').textContent = `${snapshot.topik} · ${snapshot.kelas} · ${snapshot.tanggal} · Hadir ${snapshot.summary.hadir}/${snapshot.summary.total}`;
            node('evidence-image').src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderLmsJournalEvidenceCard(snapshot, data.revision + 1, { preview: true }))}`;
            node('evidence-preview').hidden = false; node('evidence-preview').dataset.stale = 'false';
            node('confirmed').checked = false;
            node('preview-content').hidden = false;
            message(state.journalId ? `${data.refresh_state === 'updated' ? 'Kehadiran dan rekap terbaru siap diperiksa.' : 'Presensi jurnal tersimpan siap diperiksa.'} Klik ${saveLabel()} untuk konfirmasi TTD.`
                : `Isian dan presensi terisi otomatis. Periksa, lalu klik ${saveLabel()} untuk konfirmasi TTD.`);
            return true;
        } catch (error) { state.dirty = true; message(error.message, 'error'); return false; }
        finally { busy(false); }
    }
    async function sign() {
        if (state.busy) return;
        if (state.blocked) { message(state.blockedReason || 'Data jadwal belum siap untuk sinkronisasi. Buka ulang setelah jadwal diperbaiki.', 'error'); return; }
        if ((state.dirty || !state.preview) && !await preview()) return;
        const snapshot = state.preview.snapshot;
        const unassigned = snapshot.students.find(student => !student.status);
        if (unassigned) {
            message(`Presensi siswa ${unassigned.nama} belum dipilih. Silakan tentukan status presensi untuk seluruh siswa.`, 'error');
            const row = dialog.querySelector(`[data-student-nis="${unassigned.nis}"] select`);
            if (row) { row.focus(); row.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); }
            return;
        }
        const labels = { H: 'Hadir', S: 'Sakit', I: 'Izin', A: 'Alfa', D: 'Dispen', T: 'Tugas' };
        const counts = Object.entries(labels).map(([status, label]) => `${label}: ${snapshot.students.filter(student => student.status === status).length}`).join(' · ');
        node('sign-summary').textContent = `${snapshot.guru} · ${snapshot.mapel} · ${snapshot.kelas}\n${snapshot.tanggal} · JP ${snapshot.jp.join(', ')}\n${snapshot.topik}\n${counts}\nPeriode progres ${snapshot.period_start}–${snapshot.period_end}`;
        node('sign-summary').style.whiteSpace = 'pre-line';
        node('sign-attendance').innerHTML = snapshot.students.map(student => `<p><strong>${escapeLmsJournal(student.nama)}</strong> · ${labels[student.status]}${student.reason ? ` · ${escapeLmsJournal(student.reason)}` : ''}</p>`).join('');
        node('confirmation-label').textContent = `Saya telah memeriksa isian, dokumentasi, dan seluruh presensi${state.preview.revision ? ', serta menyetujui pembaruan jurnal yang sudah tersimpan' : ''}.`;
        node('confirmed').checked = false;
        node('editor').hidden = true; node('sign').hidden = false; clearSignature(); message(''); node('commit').focus();
    }
    async function commit() {
        if (state.busy || !state.preview || state.dirty) return;
        if (!node('confirmed').checked) { message('Centang konfirmasi setelah memeriksa isian, dokumentasi, dan presensi.', 'error'); node('confirmed').focus(); return; }
        if (!Number.isFinite(state.ink) || state.ink < 8) { message('Gambar tanda tangan terlebih dahulu.', 'error'); return; }
        busy(true); message('Menyimpan jurnal dan menyinkronkan e-Kinerja…');
        try {
            const result = await request('/api/lms/journal/save', { method: 'POST', body: JSON.stringify({ ...state.frozen,
                snapshot_hash: state.preview.snapshot_hash, expected_revision: state.preview.revision,
                confirm_update: state.preview.revision > 0, confirm_attendance: true, request_id: state.requestId,
                ttd: node('canvas').toDataURL('image/png') }) });
            renderSuccess(result);
            Promise.resolve().then(() => onSaved(result)).catch(error => host.console.warn('[LMS Journal] Refresh:', error.message));
        } catch (error) {
            message(error.message, 'error');
            if (error.status === 409) { node('sign').hidden = true; node('editor').hidden = false; state.dirty = true; node('confirmed').checked = false; node('evidence-preview').dataset.stale = 'true'; }
        } finally { busy(false); }
    }
    host.openLmsJournal = async (materialId, options = {}) => {
        if (state?.busy) return;
        if (!materialId) return;
        buildDialog();
        prepareMotivations();
        dialog.classList.remove('lms-journal-saved');
        dialog.setAttribute('aria-labelledby', 'lms-journal-title'); dialog.removeAttribute('aria-describedby');
        state = { materialId, journalId: options.journalId || '', entryContext: options.context || null, refreshAttendance: false,
            busy: false, dirty: true, overrides: {}, preview: null, ink: 0, topikEdited: false };
        doc.getElementById('lms-journal-title').textContent = state.journalId ? 'Edit Kehadiran Jurnal' : 'Sinkron Jurnal Mengajar';
        for (const name of ['topik', 'catatan']) field(name).readOnly = Boolean(state.journalId);
        node('attendance-help').textContent = state.journalId
            ? 'Klik Perbarui rekap untuk menghitung kehadiran dari aktivitas LMS terbaru pada periode jurnal. Koreksi manual tetap dipertahankan. Perubahan tersimpan setelah Simpan Kehadiran, konfirmasi dan TTD.'
            : 'Siswa dengan aktivitas LMS otomatis Hadir. Siswa tanpa progres silakan tentukan status presensinya secara manual.';
        node('save').textContent = saveLabel();
        node('editor').hidden = false; node('sign').hidden = true; node('result').hidden = true;
        node('preview-content').hidden = true; node('existing').hidden = true; node('attendance-empty').hidden = false; node('evidence-preview').hidden = true; node('confirmed').checked = false;
        node('evidence-image').removeAttribute('src');
        node('scope').textContent = ''; node('evidence-summary').textContent = 'Rekap materi dan progres siswa akan menjadi bukti dokumentasi jurnal.';
        for (const name of ['teacher', 'class', 'subject']) node(name).value = '';
        field('tanggal').value = options.tanggal || lmsJournalDateWita();
        for (const name of ['tanggal', 'period_start', 'period_end']) field(name).max = lmsJournalDateWita();
        for (const name of ['jp', 'schedule_note', 'catatan', 'topik']) field(name).value = '';
        renderJp();
        if (!dialog.open) dialog.showModal();
        dialog.scrollTop = 0;
        await loadContext();
    };
    host.openLmsJournalEntry = async journalId => {
        if (state?.busy) return;
        try {
            const source = await request(`/api/lms/journal/entry/${encodeURIComponent(journalId)}?attendance_only=1`);
            await host.openLmsJournal(source.material_id, { tanggal: source.tanggal,
                ...(source.context ? { journalId, context: source.context } : {}) });
        } catch (error) { notify(error.message); }
    };
    doc.addEventListener('click', event => {
        const button = event.target.closest?.('[data-lms-journal-material]');
        if (button) host.openLmsJournal(button.dataset.lmsJournalMaterial);
    });
    return { open: host.openLmsJournal };
}
