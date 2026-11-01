// Loaded only by settings.html. No global student/cache behavior is replaced here.
export function initAnnualReset({ showToast, showModernAlert, onStudentsChanged = () => {} }) {
    const el = id => document.getElementById(id);
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const admin = () => window.hasRole ? window.hasRole('super_admin') : localStorage.getItem('user_role') === 'super_admin';
    const client = () => {
        if (!window.cfClient?.enabled) throw new Error('Layanan Cloudflare belum tersedia. Silakan coba kembali.');
        return window.cfClient;
    };
    let busy = false;
    let alumniClasses = [];
    let history = [];
    let resumeOperation = null;
    const disabledBefore = new Map();
    window._annualAlumniSummary = null;

    function updateConfirmButtons() {
        const cleanupValid = ['DELETE', 'HAPUS'].includes(el('annual-input-delete-confirm')?.value.trim().toUpperCase());
        const promotionValid = ['NAIK KELAS', 'PROMOTED', 'RESET'].includes(el('annual-input-promote-confirm')?.value.trim().toUpperCase());
        for (const [id, valid] of [['btn-exec-annual-cleanup', cleanupValid && alumniClasses.length > 0], ['btn-exec-annual-promote', promotionValid]]) {
            const button = el(id);
            if (!button) continue;
            button.disabled = busy || !valid;
            button.classList.toggle('opacity-50', button.disabled);
            button.classList.toggle('cursor-not-allowed', button.disabled);
        }
    }

    function setBusy(value) {
        busy = value;
        const modal = el('modal-annual-reset');
        modal?.setAttribute('aria-busy', String(value));
        if (value) {
            disabledBefore.clear();
            modal?.querySelectorAll('button,input,select').forEach(node => { disabledBefore.set(node, node.disabled); node.disabled = true; });
        } else {
            disabledBefore.forEach((disabled, node) => { node.disabled = disabled; });
            disabledBefore.clear();
            updateConfirmButtons();
            updateHistoryActions();
        }
    }

    async function refreshStudents() {
        const warnings = [];
        for (const name of ['invalidateStudentAggregatesCache', 'invalidateActiveClassesCache', 'invalidateSystemConfig']) {
            try { await window[name]?.(); } catch (_) { warnings.push(name); }
        }
        try { onStudentsChanged(); await window.getStudentsCache?.(true); }
        catch (_) { warnings.push('students'); }
        return warnings.length ? ' Data sudah tersimpan; muat ulang halaman untuk menyegarkan tampilan.' : '';
    }

    async function downloadBackup(operation) {
        const backup = await client().getAnnualResetBackup(operation.operationId);
        if (operation.options?.snapshotToken && backup._meta.snapshotToken !== operation.options.snapshotToken) {
            throw new Error('Backup telah diperbarui oleh proses lain. Silakan coba kembali.');
        }
        const name = `SIMAS_Backup_Reset_${operation.operationId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
        const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        try {
            link.href = url; link.download = name; document.body.appendChild(link); link.click();
        } finally {
            link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        return name;
    }

    function selectedHistory() { return history.find(op => op.operationId === el('annual-history-select')?.value); }
    function updateHistoryActions() {
        const op = selectedHistory();
        if (el('annual-history-download')) el('annual-history-download').disabled = busy || !op;
        if (el('annual-history-resume')) {
            el('annual-history-resume').classList.toggle('hidden', !op || op.kind !== 'promotion' || op.status !== 'committed');
            el('annual-history-resume').disabled = busy || !op;
        }
    }

    async function loadHistory() {
        const select = el('annual-history-select');
        if (!select) return;
        try {
            history = await client().getAnnualResetHistory();
            select.replaceChildren();
            for (const op of history) {
                const option = document.createElement('option');
                option.value = op.operationId;
                const label = op.kind === 'promotion' ? `Kenaikan ${op.academicYear}` : `Alumni (${op.totalStudents} siswa)`;
                const status = { prepared: 'Backup disiapkan', committed: 'Perlu penyelesaian', completed: 'Selesai' }[op.status];
                const date = new Date(op.createdAt.replace(' ', 'T') + 'Z').toLocaleString('id-ID');
                option.textContent = `${label} · ${status} · ${date}`;
                select.appendChild(option);
            }
            if (!history.length) select.add(new Option('Belum ada riwayat reset', ''));
        } catch (error) {
            history = [];
            select.replaceChildren(new Option('Riwayat belum tersedia; coba buka ulang modul', ''));
            console.warn('[AnnualReset] History:', error);
        }
        updateHistoryActions();
    }

    async function loadClasses() {
        const select = el('annual-select-alumni-class');
        alumniClasses = [];
        select.replaceChildren(new Option('Memuat daftar alumni...', ''));
        try {
            alumniClasses = (await client().getAlumniClasses()).filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
            select.replaceChildren(new Option(`SEMUA KELAS ALUMNI (${alumniClasses.length} kelas)`, 'ALL'));
            alumniClasses.forEach(cls => select.add(new Option(cls, cls)));
            const empty = alumniClasses.length === 0;
            el('annual-alumni-empty-box').classList.toggle('hidden', !empty);
            el('annual-alumni-select-box').classList.toggle('hidden', empty);
            el('btn-exec-annual-cleanup').classList.toggle('hidden', empty);
            el('btn-annual-skip-step-1').textContent = empty ? 'Lanjut ke Kenaikan Kelas Siswa →' : 'Lewati Pembersihan Alumni →';
        } catch (error) {
            select.replaceChildren(new Option('Gagal memuat daftar alumni', ''));
            el('annual-alumni-empty-box').classList.add('hidden');
            el('annual-alumni-select-box').classList.remove('hidden');
            el('btn-exec-annual-cleanup').classList.remove('hidden');
            showToast('Daftar alumni belum tersedia', error.message, 'warning');
        }
        updateConfirmButtons();
    }

    window.setAnnualResetStep = step => {
        if (busy) return;
        for (const i of [1, 2]) {
            el(`annual-step-${i}`)?.classList.toggle('hidden', step !== i);
            el(`annual-footer-step-${i}`)?.classList.toggle('hidden', step !== i);
            const active = step === i;
            if (el(`annual-indicator-step-${i}`)) el(`annual-indicator-step-${i}`).className = `flex items-center gap-2 font-bold ${active ? 'text-emerald-700' : 'text-slate-400'}`;
            if (el(`annual-badge-step-${i}`)) el(`annual-badge-step-${i}`).className = `w-6 h-6 rounded-full flex items-center justify-center text-[11px] ${active ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`;
        }
        updateConfirmButtons();
        el(step === 1 ? 'annual-input-delete-confirm' : 'annual-input-promote-confirm')?.focus();
    };

    window.triggerAnnualReset = async () => {
        if (busy) return;
        if (!admin()) return showToast('Akses Ditolak', 'Hanya Super Admin yang dapat menjalankan reset.', 'warning');
        window._annualAlumniSummary = null;
        resumeOperation = null;
        const now = new Date();
        const endYear = now.getMonth() >= 4 ? now.getFullYear() : now.getFullYear() - 1;
        el('annual-input-academic-year').value = `${endYear - 1}/${endYear}`;
        el('annual-input-delete-confirm').value = '';
        el('annual-input-promote-confirm').value = '';
        el('annual-input-delete-confirm').oninput = updateConfirmButtons;
        el('annual-input-promote-confirm').oninput = updateConfirmButtons;
        el('annual-history-select').onchange = updateHistoryActions;
        window.setAnnualResetStep(1);
        el('modal-annual-reset').classList.remove('hidden');
        await loadClasses();
        await loadHistory();
    };

    window.executeAnnualAlumniCleanup = async () => {
        if (busy || !admin()) return;
        if (!['DELETE', 'HAPUS'].includes(el('annual-input-delete-confirm').value.trim().toUpperCase())) return updateConfirmButtons();
        const value = el('annual-select-alumni-class').value;
        const classes = value === 'ALL' ? [...alumniClasses] : alumniClasses.filter(cls => cls === value);
        if (!classes.length) return showToast('Pilih alumni', 'Tidak ada kelas alumni yang dapat dibersihkan.', 'warning');
        const options = { classes, delete_records: el('annual-check-del-records').checked, delete_bk: el('annual-check-del-bk').checked };
        const signature = JSON.stringify(options);
        let saved;
        try { saved = JSON.parse(sessionStorage.getItem('simas_annual_cleanup_pending') || 'null'); } catch (_) { /* Storage may be disabled. */ }
        const operationId = saved?.signature === signature ? saved.operationId : `cleanup:${crypto.randomUUID()}`;
        try { sessionStorage.setItem('simas_annual_cleanup_pending', JSON.stringify({ signature, operationId })); } catch (_) { /* Server history remains available. */ }
        const button = el('btn-exec-annual-cleanup');
        const original = button.innerHTML;
        let done = false;
        setBusy(true);
        try {
            button.textContent = 'Menyiapkan backup alumni...';
            let operation = await client().annualResetAction('prepare_cleanup', { ...options, operationId, refresh: true });
            let fileName = '';
            if (operation.status === 'prepared') {
                fileName = await downloadBackup(operation);
                button.textContent = 'Menghapus data alumni...';
                operation = await client().annualResetAction('commit', { operationId, backupAcknowledged: true, snapshotToken: operation.options.snapshotToken });
            }
            if (operation.status !== 'completed') throw new Error('Pembersihan belum terkonfirmasi selesai. Coba kembali untuk melanjutkan operasi yang sama.');
            window._annualAlumniSummary = { totalDeleted: operation.totalStudents, classes, fileName };
            try { sessionStorage.removeItem('simas_annual_cleanup_pending'); } catch (_) { /* Safe retry on server. */ }
            const warning = await refreshStudents();
            showToast('Pembersihan Selesai', `${operation.totalStudents} alumni dibersihkan. Backup tersedia di riwayat reset.${warning}`, 'success');
            done = true;
        } catch (error) {
            showModernAlert('Pembersihan belum selesai', `${escape(error.message)}<br>Backup yang sudah disiapkan tersedia di riwayat reset. Percobaan ulang memakai operasi yang sama.`, 'error');
        } finally {
            button.innerHTML = original;
            setBusy(false);
            if (done) window.setAnnualResetStep(2);
            await loadHistory();
        }
    };

    window.executeAnnualClassPromotion = async () => {
        if (busy || !admin()) return;
        if (!['NAIK KELAS', 'PROMOTED', 'RESET'].includes(el('annual-input-promote-confirm').value.trim().toUpperCase())) return updateConfirmButtons();
        const academicYear = el('annual-input-academic-year').value.trim();
        if (!/^\d{4}\/\d{4}$/.test(academicYear) || Number(academicYear.slice(5)) !== Number(academicYear.slice(0, 4)) + 1) {
            return showToast('Tahun ajaran tidak valid', 'Gunakan tahun berurutan, contoh 2025/2026.', 'warning');
        }
        const button = el('btn-exec-annual-promote');
        const original = button.innerHTML;
        let operation = resumeOperation;
        resumeOperation = null;
        setBusy(true);
        try {
            button.textContent = 'Menyiapkan backup kenaikan...';
            operation ||= await client().annualResetAction('prepare_promotion', { academicYear, refresh: true });
            if (operation.status === 'prepared') {
                await downloadBackup(operation);
                button.textContent = 'Memproses kenaikan kelas...';
                operation = await client().annualResetAction('commit', { operationId: operation.operationId,
                    backupAcknowledged: true, snapshotToken: operation.options.snapshotToken });
            }
            if (operation.status === 'committed') {
                button.textContent = 'Menyelesaikan penugasan wali kelas...';
                operation = await client().annualResetAction('finalize', { operationId: operation.operationId });
            }
            if (operation.status !== 'completed') throw new Error('Status reset belum selesai. Gunakan riwayat untuk melanjutkan.');
            const warning = await refreshStudents();
            el('modal-annual-reset').classList.add('hidden');
            const alumni = window._annualAlumniSummary;
            showModernAlert('Reset Data Tahunan Selesai', `<div class="text-left space-y-2">
                <p>Siswa naik jenjang: <b>${Number(operation.promotedCount) || 0}</b>.</p>
                <p>Siswa menjadi alumni: <b>${Number(operation.alumniCount) || 0}</b> (${escape(operation.academicYear)}).</p>
                ${alumni ? `<p>Alumni lama dibersihkan: <b>${alumni.totalDeleted}</b>.</p>` : ''}
                <p>Penugasan wali kelas lama sudah dikosongkan; role lainnya dipertahankan.</p>
                <p class="text-xs text-slate-500">Riwayat siswa tetap dipertahankan. Backup dapat diunduh ulang dari riwayat reset.${escape(warning)}</p></div>`);
        } catch (error) {
            const committed = operation?.status === 'committed';
            if (committed) await refreshStudents();
            showModernAlert(committed ? 'Kenaikan tersimpan, penyelesaian tertunda' : 'Reset belum terkonfirmasi selesai',
                `${escape(error.message)}<br>${committed ? 'Siswa sudah naik kelas. Gunakan tombol Lanjutkan penyelesaian di riwayat reset untuk menyelesaikan akun wali kelas.' : 'Klik proses kembali untuk memeriksa dan melanjutkan operasi yang sama.'}<br>Percobaan ulang tidak menaikkan siswa dua kali.`, 'error');
        } finally {
            button.innerHTML = original;
            setBusy(false);
            await loadHistory();
        }
    };

    window.downloadAnnualResetHistory = async () => {
        if (busy || !admin()) return;
        const operation = selectedHistory();
        if (!operation) return;
        setBusy(true);
        try { await downloadBackup(operation); showToast('Backup siap', 'Unduhan backup telah dimulai.', 'success'); }
        catch (error) { showToast('Backup belum tersedia', error.message, 'error'); }
        finally { setBusy(false); }
    };
    window.resumeAnnualReset = async () => {
        if (busy || !admin()) return;
        const operation = selectedHistory();
        if (operation?.kind !== 'promotion' || operation.status !== 'committed') return;
        resumeOperation = operation;
        el('annual-input-academic-year').value = operation.academicYear;
        el('annual-input-promote-confirm').value = 'NAIK KELAS';
        window.setAnnualResetStep(2);
        await window.executeAnnualClassPromotion();
    };
    window.triggerClassPromotion = window.triggerAnnualReset;
    window.triggerDeleteAlumni = window.triggerAnnualReset;
    window.triggerModularReset = window.triggerAnnualReset;
    window.executeClassPromotion = window.executeAnnualClassPromotion;
    window.executeDeleteAlumniClass = window.executeAnnualAlumniCleanup;
}
