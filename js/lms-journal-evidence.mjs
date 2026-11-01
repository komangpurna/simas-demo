function lmsJournalEvidenceXml(value) {
    return String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
        .replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
}

// Preserve the original layout for evidence signed before detailed learning snapshots existed.
function renderLmsJournalLegacyEvidence(snapshot, revision, { preview = false } = {}) {
    const lines = [
        ...(preview ? ['PRATINJAU • BELUM DISAHKAN'] : []),
        `${snapshot.tanggal} • ${snapshot.kelas} • JP ${snapshot.jp.join(', ')}`,
        `${snapshot.guru} • ${snapshot.mapel}`, snapshot.topik.length > 350 ? snapshot.topik.slice(0, 347) + '…' : snapshot.topik,
        `Hadir: ${snapshot.summary.hadir}/${snapshot.summary.total} • Ada progres: ${snapshot.summary.berprogres}`,
        `Periode progres: ${snapshot.period_start} sampai ${snapshot.period_end}`,
        `Rekap: ${new Date(Date.parse(snapshot.snapshot_at) + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ')} WITA • Revisi ${revision}`,
        preview ? 'Dokumentasi disimpan setelah konfirmasi dan tanda tangan guru.' : 'Bukti aktivitas LMS yang telah diperiksa dan disahkan guru.'
    ];
    const wrapped = lines.flatMap(line => String(line).match(/.{1,75}(?:\s|$)|.{1,75}/g) || ['']).slice(0, 18);
    const height = 120 + wrapped.length * 30;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${height}" viewBox="0 0 1000 ${height}">
        <rect width="1000" height="${height}" rx="24" fill="#f0fdf4"/><rect width="1000" height="10" fill="#059669"/>
        <text x="36" y="58" font-family="Arial,sans-serif" font-size="30" font-weight="bold" fill="#065f46">Bukti pembelajaran LMS</text>
        ${wrapped.map((line, index) => `<text x="36" y="${100 + index * 30}" font-family="Arial,sans-serif" font-size="20" fill="#1e293b">${lmsJournalEvidenceXml(line)}</text>`).join('')}
    </svg>`;
}

export function formatLmsJournalDuration(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) < 0) return '—';
    const seconds = Math.floor(Number(value)), minutes = Math.floor(seconds / 60);
    if (seconds < 60) return `${seconds} dtk`;
    if (minutes < 60) return `${minutes} mnt${seconds % 60 ? ` ${seconds % 60} dtk` : ''}`;
    return `${Math.floor(minutes / 60)} jam${minutes % 60 ? ` ${minutes % 60} mnt` : ''}`;
}

function lmsJournalEvidenceLines(value, limit) {
    const words = String(value || '').trim().split(/\s+/), lines = []; let line = '';
    for (const word of words) {
        const chunks = Array.from(word);
        while (chunks.length > limit) {
            if (line) { lines.push(line); line = ''; }
            lines.push(chunks.splice(0, limit).join(''));
        }
        const rest = chunks.join('');
        if (line && Array.from(`${line} ${rest}`).length > limit) { lines.push(line); line = rest; }
        else line = line ? `${line} ${rest}` : rest;
    }
    if (line || !lines.length) lines.push(line);
    return lines;
}

function renderLmsBrowserFrame(x, y, width, height, urlText, panelDataAttr) {
    return `<g ${panelDataAttr}>
        <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="18" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5"/>
        <path d="M${x + 1} ${y + 1}h${width - 2}q17 0 17 17v24h-${width}v-24q0 -17 17 -17" fill="#f8fafc"/>
        <line x1="${x}" y1="${y + 42}" x2="${x + width}" y2="${y + 42}" stroke="#e2e8f0" stroke-width="1"/>
        <circle cx="${x + 22}" cy="${y + 21}" r="4.5" fill="#f43f5e"/>
        <circle cx="${x + 36}" cy="${y + 21}" r="4.5" fill="#fbbf24"/>
        <circle cx="${x + 50}" cy="${y + 21}" r="4.5" fill="#10b981"/>
        <rect x="${x + 70}" y="${y + 10}" width="${width - 88}" height="22" rx="7" fill="#eef2f6"/>
        <text x="${x + 84}" y="${y + 25}" font-size="11.5" fill="#64748b" font-weight="600">${lmsJournalEvidenceXml(urlText)}</text>
    </g>`;
}

function renderLmsMaterialPanel(material = {}, x, y, width, height) {
    const xml = lmsJournalEvidenceXml;
    const type = String(material.resource_type || material.type || 'text').toLowerCase();
    const typeConfigs = {
        youtube: { label: 'VIDEO PEMBELAJARAN', color: '#be123c', bg: '#ffe4e6' },
        video: { label: 'VIDEO PEMBELAJARAN', color: '#be123c', bg: '#ffe4e6' },
        gdrive: { label: 'DOKUMEN GOOGLE DRIVE / PDF', color: '#047857', bg: '#d1fae5' },
        pdf: { label: 'DOKUMEN MATERI PDF', color: '#047857', bg: '#d1fae5' },
        link: { label: 'SUMBER TAUTAN WEB', color: '#0284c7', bg: '#e0f2fe' }
    };
    const config = typeConfigs[type] || { label: 'BACAAN & INSTRUKSI LMS', color: '#4f46e5', bg: '#e0e7ff' };
    const frame = renderLmsBrowserFrame(x, y, width, height, `lms.smagesa.sch.id / materi / ${type}`, 'data-collage-panel="material"');
    const titleLines = lmsJournalEvidenceLines(material.title || 'Materi Pembelajaran', 48).slice(0, 2);
    const rawDesc = material.description || material.instructions || "Materi pembelajaran LMS SIMAS SMANTARA.";
    const descLines = lmsJournalEvidenceLines(rawDesc, 62).slice(0, 3);

    return `${frame}
    <g font-family="Arial,sans-serif">
        <rect x="${x + 20}" y="${y + 56}" width="220" height="26" rx="8" fill="${config.bg}"/>
        <text x="${x + 32}" y="${y + 73}" font-size="12" fill="${config.color}" font-weight="700">${xml(config.label)}</text>
        ${titleLines.map((line, idx) => `<text x="${x + 20}" y="${y + 106 + idx * 22}" font-size="16" fill="#0f172a" font-weight="700">${xml(line)}</text>`).join('')}
        ${descLines.map((line, idx) => `<text x="${x + 20}" y="${y + 154 + idx * 19}" font-size="13" fill="#475569">${xml(line)}</text>`).join('')}
        <rect x="${x + 16}" y="${y + height - 34}" width="${width - 32}" height="24" rx="6" fill="#f1f5f9"/>
        <text x="${x + 26}" y="${y + height - 18}" font-size="11.5" fill="#475569" font-weight="600">✓ Bahan Ajar Terbit di LMS  •  Tersinkron ke Jurnal KBM</text>
    </g>`;
}

function renderLmsInteractivePanel(interactive = {}, x, y, width, height) {
    const xml = lmsJournalEvidenceXml;
    const type = String(interactive.type || 'guide').toLowerCase();

    if (type === 'discussion') {
        const frame = renderLmsBrowserFrame(x, y, width, height, 'lms.smagesa.sch.id / forum-diskusi', 'data-collage-panel="interactive" data-interactive-type="discussion"');
        const prompt = String(interactive.prompt || 'Forum Diskusi & Refleksi Kelas');
        const promptLines = lmsJournalEvidenceLines(prompt, 54).slice(0, 1);
        const comment = (interactive.comments && interactive.comments[0]) || { user_name: 'Siswa Aktif', user_role: 'siswa', content: 'Siap mempelajari materi dan berdiskusi.' };
        const initial = (String(comment.user_name || 'S').trim()[0] || 'S').toUpperCase();
        const roleLabel = String(comment.user_role || 'siswa').toUpperCase();
        const commentLines = lmsJournalEvidenceLines(comment.content || '', 56).slice(0, 2);

        return `${frame}
        <g font-family="Arial,sans-serif">
            <rect x="${x + 20}" y="${y + 56}" width="210" height="26" rx="8" fill="#ccfbf1"/>
            <text x="${x + 32}" y="${y + 73}" font-size="12" fill="#0f766e" font-weight="700">FORUM DISKUSI AKTIF</text>
            <text x="${x + 240}" y="${y + 73}" font-size="12" fill="#0d9488" font-weight="600">💬 Interaksi Kelas</text>
            ${promptLines.map((line, idx) => `<text x="${x + 20}" y="${y + 102 + idx * 18}" font-size="14" fill="#0f172a" font-weight="700">${xml(line)}</text>`).join('')}
            <rect x="${x + 18}" y="${y + 114}" width="${width - 36}" height="76" rx="12" fill="#f8fafc" stroke="#e2e8f0"/>
            <circle cx="${x + 38}" cy="${y + 138}" r="13" fill="#0284c7"/>
            <text x="${x + 38}" y="${y + 143}" font-size="11" fill="#ffffff" font-weight="700" text-anchor="middle">${xml(initial)}</text>
            <text x="${x + 60}" y="${y + 136}" font-size="13" fill="#0f172a" font-weight="700">${xml(comment.user_name)}</text>
            <rect x="${x + 60 + Math.min(220, String(comment.user_name || '').length * 8) + 8}" y="${y + 124}" width="46" height="18" rx="6" fill="#e0f2fe"/>
            <text x="${x + 66 + Math.min(220, String(comment.user_name || '').length * 8) + 8}" y="${y + 136}" font-size="9.5" fill="#0369a1" font-weight="700">${xml(roleLabel)}</text>
            ${commentLines.map((line, idx) => `<text x="${x + 60}" y="${y + 157 + idx * 18}" font-size="12.5" fill="#334155">${xml(line)}</text>`).join('')}
            <rect x="${x + 16}" y="${y + height - 34}" width="${width - 32}" height="24" rx="6" fill="#f0fdf4"/>
            <text x="${x + 26}" y="${y + height - 18}" font-size="11.5" fill="#047857" font-weight="600">✓ Interaksi Diskusi Terverifikasi  •  Tercatat di LMS</text>
        </g>`;
    }

    if (type === 'quiz') {
        const frame = renderLmsBrowserFrame(x, y, width, height, 'lms.smagesa.sch.id / evaluasi-cbt', 'data-collage-panel="interactive" data-interactive-type="quiz"');
        const qTotal = Number(interactive.total_questions) || 1;
        const qType = String(interactive.question_type || 'Pilihan Ganda');
        const qText = String(interactive.question_text || 'Pertanyaan uji pemahaman materi.');
        const qLines = lmsJournalEvidenceLines(qText, 58).slice(0, 2);
        const options = Array.isArray(interactive.options) ? interactive.options : [];
        const optA = options[0] || 'Opsi Jawaban A';
        const optB = options[1] || 'Opsi Jawaban B';

        return `${frame}
        <g font-family="Arial,sans-serif">
            <rect x="${x + 20}" y="${y + 56}" width="190" height="26" rx="8" fill="#ede9fe"/>
            <text x="${x + 32}" y="${y + 73}" font-size="12" fill="#6d28d9" font-weight="700">EVALUASI CBT / KUIS</text>
            <rect x="${x + 220}" y="${y + 56}" width="120" height="26" rx="8" fill="#f5f3ff"/>
            <text x="${x + 232}" y="${y + 73}" font-size="12" fill="#7c3aed" font-weight="700">${qTotal} Butir Soal</text>
            <rect x="${x + 18}" y="${y + 92}" width="${width - 36}" height="98" rx="12" fill="#faf5ff" stroke="#e9d5ff"/>
            <text x="${x + 32}" y="${y + 112}" font-size="12" fill="#7c3aed" font-weight="700">SOAL NO. 1 (${xml(qType)})</text>
            ${qLines.map((line, idx) => `<text x="${x + 32}" y="${y + 132 + idx * 18}" font-size="13" fill="#1e293b" font-weight="600">${xml(line)}</text>`).join('')}
            <rect x="${x + 32}" y="${y + 162}" width="180" height="20" rx="6" fill="#ffffff" stroke="#d8b4fe"/>
            <text x="${x + 40}" y="${y + 176}" font-size="11" fill="#6d28d9" font-weight="600">A. ${xml(optA.slice(0, 24))}</text>
            <rect x="${x + 222}" y="${y + 162}" width="180" height="20" rx="6" fill="#ffffff" stroke="#d8b4fe"/>
            <text x="${x + 230}" y="${y + 176}" font-size="11" fill="#6d28d9" font-weight="600">B. ${xml(optB.slice(0, 24))}</text>
            <rect x="${x + 16}" y="${y + height - 34}" width="${width - 32}" height="24" rx="6" fill="#f5f3ff"/>
            <text x="${x + 26}" y="${y + height - 18}" font-size="11.5" fill="#6d28d9" font-weight="600">⚡ Uji Pemahaman CBT Terintegrasi  •  Koreksi Otomatis</text>
        </g>`;
    }

    const frame = renderLmsBrowserFrame(x, y, width, height, 'lms.smagesa.sch.id / panduan-kbm', 'data-collage-panel="interactive" data-interactive-type="guide"');
    const est = Number(interactive.estimated_minutes) || 45;

    return `${frame}
    <g font-family="Arial,sans-serif">
        <rect x="${x + 20}" y="${y + 56}" width="220" height="26" rx="8" fill="#ffedd5"/>
        <text x="${x + 32}" y="${y + 73}" font-size="12" fill="#c2410c" font-weight="700">PANDUAN BELAJAR MANDIRI</text>
        <rect x="${x + 250}" y="${y + 56}" width="150" height="26" rx="8" fill="#fff7ed"/>
        <text x="${x + 262}" y="${y + 73}" font-size="12" fill="#ea580c" font-weight="700">⏱ Estimasi ${est} Menit</text>
        <rect x="${x + 18}" y="${y + 92}" width="${width - 36}" height="98" rx="12" fill="#fffbeb" stroke="#fef3c7"/>
        <text x="${x + 32}" y="${y + 116}" font-size="13" fill="#92400e" font-weight="600">✓ Eksplorasi materi &amp; bahan ajar hingga tuntas</text>
        <text x="${x + 32}" y="${y + 138}" font-size="13" fill="#92400e" font-weight="600">✓ Catat ringkasan &amp; pemahaman inti secara mandiri</text>
        <text x="${x + 32}" y="${y + 160}" font-size="13" fill="#92400e" font-weight="600">✓ Aktivitas tercatat otomatis ke dalam presensi KBM</text>
        <rect x="${x + 16}" y="${y + height - 34}" width="${width - 32}" height="24" rx="6" fill="#fffbeb"/>
        <text x="${x + 26}" y="${y + height - 18}" font-size="11.5" fill="#b45309" font-weight="600">🎯 Mode Belajar Terfokus  •  Aktivitas Mandiri Terverifikasi</text>
    </g>`;
}

export function renderLmsJournalEvidenceCard(snapshot, revision, { preview = false } = {}) {
    if (snapshot.learning_version !== 1) return renderLmsJournalLegacyEvidence(snapshot, revision, { preview });
    const xml = lmsJournalEvidenceXml, students = snapshot.students || [], total = students.length;
    const materialCount = Math.max(1, snapshot.material_ids?.length || snapshot.materials?.length || 1);
    const date = String(snapshot.tanggal || '').split('-').reverse().join('/');
    const recap = new Date(Date.parse(snapshot.snapshot_at) + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
    const topic = String(snapshot.topik || ''), topicLines = lmsJournalEvidenceLines(topic.length > 350 ? `${topic.slice(0, 347)}…` : topic, 95);
    const identityLines = lmsJournalEvidenceLines(`${snapshot.guru}   •   ${snapshot.mapel}`, 95);
    const topicY = 182 + identityLines.length * 26 + 12;
    const headerBottom = topicY + topicLines.length * 30 + 20;
    const hasCollage = Boolean(snapshot.evidence_collage);
    const collageHeight = hasCollage ? 300 : 0;
    const collageY = headerBottom + 24;
    const statsY = hasCollage ? collageY + collageHeight + 24 : headerBottom + 24;
    const tableY = statsY + 198, tableWidth = 1288;
    const learningLabels = { completed: 'Selesai belajar', in_progress: 'Sedang belajar', not_opened: 'Belum membuka', activity_only: 'Ada aktivitas' };
    const attendanceLabels = { H: 'Hadir', S: 'Sakit', I: 'Izin', A: 'Alfa', D: 'Dispen', T: 'Tugas' };
    let cursor = tableY + 50;
    const text = (x, y, value, size = 21, color = '#0f172a', extra = '') => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" ${extra}>${xml(value)}</text>`;
    const badge = (x, y, width, label, color, bg) => `<rect x="${x}" y="${y}" width="${width}" height="32" rx="10" fill="${bg}"/>${text(x + 12, y + 22, label, 17, color, 'font-weight="700"')}`;
    const rows = students.map((student, index) => {
        const nameLines = lmsJournalEvidenceLines(student.nama, 37), height = Math.max(78, nameLines.length * 26 + 28), y = cursor;
        cursor += height;
        const completed = Math.min(materialCount, Math.max(0, Number(student.materials_completed) || 0));
        const done = student.learning_status === 'completed', unopened = student.learning_status === 'not_opened';
        const statusColor = done ? '#047857' : unopened ? '#64748b' : '#a16207';
        const statusBg = done ? '#d1fae5' : unopened ? '#f1f5f9' : '#fef3c7';
        const attendanceColor = student.status === 'H' ? '#047857' : student.status === 'A' ? '#be123c' : '#1d4ed8';
        const attendanceBg = student.status === 'H' ? '#d1fae5' : student.status === 'A' ? '#ffe4e6' : '#dbeafe';
        return `<g data-evidence-student-row="${index + 1}"><rect x="56" y="${y}" width="${tableWidth}" height="${height}" fill="${index % 2 ? '#f8fafc' : '#ffffff'}"/>
            <line x1="56" y1="${y + height}" x2="1344" y2="${y + height}" stroke="#e2e8f0"/>
            ${text(78, y + 36, index + 1, 18, '#64748b')}
            ${nameLines.map((line, lineIndex) => text(136, y + 32 + lineIndex * 26, line, 21, '#1e293b', 'font-weight="600"')).join('')}
            ${badge(620, y + 12, 204, learningLabels[student.learning_status] || 'Belum tercatat', statusColor, statusBg)}
            ${text(622, y + 65, `${completed}/${materialCount} materi selesai`, 15, '#64748b')}
            ${text(910, y + 37, formatLmsJournalDuration(student.active_seconds), 20, '#334155', 'font-weight="600"')}
            ${badge(1170, y + 14, 148, attendanceLabels[student.status] || '—', attendanceColor, attendanceBg)}</g>`;
    }).join('');
    const footerY = cursor + 24, height = footerY + 190;
    const stats = [
        { label: 'JUMLAH SISWA', value: total, sub: 'Seluruh siswa dalam rekap', color: '#2563eb', bg: '#eff6ff' },
        { label: 'BERAKTIVITAS', value: snapshot.summary.berprogres, sub: 'Pada periode presensi', color: '#d97706', bg: '#fffbeb' },
        { label: 'SELESAI BELAJAR', value: snapshot.summary.selesai, sub: 'Seluruh materi terpilih', color: '#059669', bg: '#ecfdf5' },
        { label: 'PRESENSI HADIR', value: `${snapshot.summary.hadir}/${total}`, sub: 'Sesuai rekap yang diperiksa', color: '#7c3aed', bg: '#f5f3ff' }
    ];
    const collageSvg = hasCollage ? `
            <text x="56" y="${collageY + 14}" font-size="16" fill="#0f172a" font-weight="700" letter-spacing="1">DOKUMENTASI PEMBELAJARAN  /  KOLASE TAMPILAN MATERI &amp; INTERAKSI SISWA</text>
            ${renderLmsMaterialPanel(snapshot.evidence_collage.material, 56, collageY + 30, 634, 260)}
            ${renderLmsInteractivePanel(snapshot.evidence_collage.interactive || {}, 710, collageY + 30, 634, 260)}` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="${height}" viewBox="0 0 1400 ${height}" role="img" aria-labelledby="evidence-title evidence-desc">
        <title id="evidence-title">Bukti pembelajaran LMS — ${xml(snapshot.kelas)}</title><desc id="evidence-desc">Hadir: ${snapshot.summary.hadir}/${total} • Ada progres: ${snapshot.summary.berprogres}. Rincian seluruh ${total} siswa.</desc>
        <rect width="1400" height="${height}" fill="#eef2f7"/><rect x="24" y="24" width="1352" height="${height - 48}" rx="28" fill="#ffffff"/>
        <g font-family="Arial,sans-serif"><path d="M52 24H1348Q1376 24 1376 52V${headerBottom}H24V52Q24 24 52 24" fill="#0f172a"/>
            ${text(56, 64, 'SIMAS  /  JURNAL MENGAJAR', 16, '#6ee7b7', 'font-weight="700" letter-spacing="2"')}
            ${text(56, 112, 'Bukti pembelajaran LMS', 40, '#ffffff', 'font-weight="700"')}
            ${text(56, 145, preview ? 'PRATINJAU • BELUM DISAHKAN' : 'REKAP DISAHKAN GURU', 17, '#cbd5e1')}
            <rect x="1110" y="54" width="220" height="102" rx="18" fill="#1e293b"/>
            ${text(1130, 85, 'KELAS', 14, '#94a3b8', 'font-weight="700"')}${text(1130, 116, snapshot.kelas, 26, '#ffffff', 'font-weight="700"')}${text(1130, 142, date, 16, '#cbd5e1')}
            ${identityLines.map((line, index) => text(56, 182 + index * 26, line, 20, '#e2e8f0')).join('')}
            ${topicLines.map((line, index) => text(56, topicY + index * 30, line, 23, '#ffffff', 'font-weight="600"')).join('')}
            ${collageSvg}
            ${stats.map((stat, index) => { const x = 56 + index * 326; return `<rect x="${x}" y="${statsY}" width="310" height="100" rx="16" fill="${stat.bg}"/>${text(x + 18, statsY + 26, stat.label, 14, stat.color, 'font-weight="700"')}${text(x + 18, statsY + 65, stat.value, 34, stat.color, 'font-weight="700"')}${text(x + 18, statsY + 88, stat.sub, 14, '#64748b')}`; }).join('')}
            ${text(56, statsY + 135, `JP ${snapshot.jp.join(', ')}  •  Periode presensi ${snapshot.period_start} s.d. ${snapshot.period_end}`, 18, '#475569')}
            ${text(56, statsY + 174, `RINCIAN SELURUH SISWA  /  ${total} SISWA`, 17, '#0f172a', 'font-weight="700" letter-spacing="1"')}
            <rect x="56" y="${tableY}" width="${tableWidth}" height="50" rx="10" fill="#e2e8f0"/>
            ${text(78, tableY + 32, 'NO', 15, '#475569', 'font-weight="700"')}${text(136, tableY + 32, 'NAMA SISWA', 15, '#475569', 'font-weight="700"')}${text(622, tableY + 32, 'STATUS BELAJAR', 15, '#475569', 'font-weight="700"')}${text(910, tableY + 32, 'DURASI AKTIF', 15, '#475569', 'font-weight="700"')}${text(1172, tableY + 32, 'PRESENSI', 15, '#475569', 'font-weight="700"')}
            ${rows}
            <rect x="56" y="${footerY}" width="1288" height="98" rx="14" fill="#f8fafc"/>
            ${text(76, footerY + 29, 'Durasi dan status belajar merupakan akumulasi pada materi hingga waktu rekap.', 18, '#475569')}
            ${text(76, footerY + 56, 'Durasi bukan hitungan harian. Tanda — berarti durasi belum tercatat.', 17, '#64748b')}
            ${text(76, footerY + 81, 'Kehadiran mengikuti aktivitas pada periode presensi dan koreksi guru.', 17, '#64748b')}
            ${text(56, footerY + 133, `Direkap ${recap} WITA  •  Revisi ${revision}`, 16, '#64748b')}
            ${text(56, footerY + 160, preview ? 'Dokumentasi disimpan setelah konfirmasi dan tanda tangan guru.' : 'Bukti aktivitas LMS yang telah diperiksa dan disahkan guru.', 16, preview ? '#a16207' : '#047857', 'font-weight="600"')}
        </g></svg>`;
}
