/* js/utils.mjs - Fungsi Utilitas Teruji Mandiri (Testable Utilities) */

export function formatAppVersion(version) {
  return `v${version}`;
}

export function normalizeNIS(value) {
  return String(value ?? '').trim();
}

export function getFriendlyErrorMessage(error, actionType = 'proses') {
  const code = error?.code || '';
  const message = String(error?.message || '').toLowerCase();
  
  if (code === 'permission-denied' || message.includes('permission') || message.includes('denied')) {
    if (actionType === 'cancel') {
      return "Pengajuan ini sudah diproses atau disetujui oleh guru/wali kelas sehingga tidak dapat dibatalkan.";
    }
    if (actionType === 'edit') {
      return "Pengajuan ini sudah diproses atau disetujui oleh guru/wali kelas sehingga tidak dapat diubah.";
    }
    return "Pengajuan ini sudah diproses atau disetujui oleh guru/wali kelas.";
  }
  return error?.message || "Terjadi kesalahan sistem.";
}

/**
 * Memformat angka ke format mata uang Rupiah (contoh: 50000 -> "Rp 50.000")
 */
export function formatRupiah(amount) {
  const num = Number(amount);
  if (isNaN(num)) return "Rp 0";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(num).replace("IDR", "Rp").trim();
}

/**
 * Memvalidasi alamat email sederhana
 */
export function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email.trim());
}

/**
 * Memparsing representasi JP (Array angka, JSON string array, string range, angka tunggal)
 * menjadi array nomor JP berurutan (1 s.d. 10).
 */
export function parseJpList(jp) {
  if (!jp && jp !== 0) return [];
  if (Array.isArray(jp)) {
    return jp.map(Number).filter((n) => !isNaN(n) && n >= 1 && n <= 10);
  }
  if (typeof jp === "number") {
    return jp >= 1 && jp <= 10 ? [jp] : [];
  }
  if (typeof jp === "string") {
    const trimmed = jp.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map(Number).filter((n) => !isNaN(n) && n >= 1 && n <= 10);
        }
      } catch (e) {}
    }
    if (trimmed.includes("-")) {
      const parts = trimmed.split("-").map((p) => parseInt(p.trim(), 10));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        const start = Math.min(parts[0], parts[1]);
        const end = Math.max(parts[0], parts[1]);
        const res = [];
        for (let i = start; i <= end; i++) {
          if (i >= 1 && i <= 10) res.push(i);
        }
        return res;
      }
    }
    if (trimmed.includes(",")) {
      return trimmed
        .split(",")
        .map((p) => parseInt(p.trim(), 10))
        .filter((n) => !isNaN(n) && n >= 1 && n <= 10);
    }
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 1 && num <= 10) {
      return [num];
    }
  }
  return [];
}

/**
 * Memformat representasi JP untuk tampilan yang rapi (misal: "1", "1-2", "3-5").
 */
export function formatJpDisplay(jp) {
  const list = parseJpList(jp);
  if (list.length === 0) return typeof jp === "string" && jp.trim() !== "" ? jp : "-";
  if (list.length === 1 || Math.min(...list) === Math.max(...list)) {
    return `${list[0]}`;
  }
  return `${Math.min(...list)}-${Math.max(...list)}`;
}

/**
 * Mengekstrak string tanggal ISO (YYYY-MM-DD) dari entri Jurnal (Cloudflare D1 / Firestore).
 */
export function getJurnalDateStr(data) {
  if (!data) return "";
  if (data.tanggal && typeof data.tanggal === "string") {
    return data.tanggal.trim().slice(0, 10);
  }
  if (data.created_at && typeof data.created_at === "string") {
    return data.created_at.trim().slice(0, 10);
  }
  if (data.timestamp) {
    const ts = data.timestamp;
    if (typeof ts.toDate === "function") {
      const d = ts.toDate();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    if (ts instanceof Date) {
      return `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}-${String(ts.getDate()).padStart(2, "0")}`;
    }
    if (typeof ts.seconds === "number") {
      const d = new Date(ts.seconds * 1000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    if (typeof ts === "string" || typeof ts === "number") {
      const d = new Date(ts);
      if (!isNaN(d.getTime())) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      }
    }
  }
  return "";
}

/**
 * Mencocokkan nama kelas dari berbagai format pemisah (misal 'X.1', 'X-1', 'X 1') ke kunci objek target.
 */
export function findMatchingClassKey(targetClass, matrixOrObj) {
  if (!targetClass || !matrixOrObj) return null;
  if (matrixOrObj[targetClass]) return targetClass;
  const cleanTarget = String(targetClass).trim().replace(/[\.\s_]/g, '-').toUpperCase();
  for (const k of Object.keys(matrixOrObj)) {
    if (String(k).trim().replace(/[\.\s_]/g, '-').toUpperCase() === cleanTarget) {
      return k;
    }
  }
  return null;
}

/**
 * Menghapus tag HTML dasar dari input pengguna untuk keamanan XSS dasar
 */
export function sanitizeString(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Membandingkan kesetaraan dua nama kelas dengan menoleransi perbedaan spasi, titik, strip, dan huruf besar/kecil.
 */
export function isClassEqual(c1, c2) {
  if (!c1 || !c2) return false;
  if (c1 === c2) return true;
  const clean1 = String(c1).trim().replace(/[\.\s_]/g, '-').toUpperCase();
  const clean2 = String(c2).trim().replace(/[\.\s_]/g, '-').toUpperCase();
  return clean1 === clean2;
}

/**
 * Menghitung urgensi tenggat waktu (due date) modul LMS.
 * @param {string} dueDateStr - Tanggal jatuh tempo (YYYY-MM-DD)
 * @param {boolean} isCompleted - Apakah modul sudah tuntas diselesaikan oleh siswa
 * @param {Date|string|null} nowParam - Override tanggal acuan (untuk testing deterministik)
 * @returns {object} { level, label, badgeClass, icon, daysRemaining, isUrgent }
 */
export function calculateDueDateUrgency(dueDateStr, isCompleted = false, nowParam = null) {
  if (typeof dueDateStr === 'string' && dueDateStr.includes('T')) {
    const raw = dueDateStr.trim();
    const due = new Date(/(Z|[+-]\d{2}:\d{2})$/i.test(raw) ? raw : `${raw}+08:00`);
    const now = nowParam ? new Date(nowParam) : new Date();
    if (Number.isFinite(due.getTime())) {
      const expired = due.getTime() <= now.getTime();
      const witaDay = date => Math.floor((date.getTime() + 8 * 3600000) / 86400000);
      const daysRemaining = witaDay(due) - witaDay(now);
      const formatted = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Makassar', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(due) + ' WITA';
      return {
        level: isCompleted ? 'completed' : expired ? 'overdue' : daysRemaining === 0 ? 'today' : daysRemaining === 1 ? 'tomorrow' : daysRemaining <= 3 ? 'soon' : 'normal',
        label: `${expired && !isCompleted ? 'Lewat target' : 'Target'}: ${formatted}`,
        badgeClass: isCompleted ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300' : expired ? 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300' : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300',
        icon: expired && !isCompleted ? 'fa-solid fa-clock-rotate-left' : 'fa-regular fa-clock',
        daysRemaining,
        isUrgent: !isCompleted && (expired || daysRemaining <= 1)
      };
    }
  }
  if (!dueDateStr || typeof dueDateStr !== 'string') {
    return {
      level: 'none',
      label: '',
      badgeClass: '',
      icon: '',
      daysRemaining: null,
      isUrgent: false
    };
  }

  const cleanDue = dueDateStr.trim().slice(0, 10);
  const parts = cleanDue.split('-');
  if (parts.length !== 3) {
    return {
      level: 'none',
      label: cleanDue,
      badgeClass: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300',
      icon: 'fa-regular fa-clock',
      daysRemaining: null,
      isUrgent: false
    };
  }

  const dueYear = Number(parts[0]);
  const dueMonth = Number(parts[1]) - 1;
  const dueDay = Number(parts[2]);

  const dueDate = new Date(dueYear, dueMonth, dueDay, 23, 59, 59, 999);
  if (isNaN(dueDate.getTime())) {
    return {
      level: 'none',
      label: cleanDue,
      badgeClass: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300',
      icon: 'fa-regular fa-clock',
      daysRemaining: null,
      isUrgent: false
    };
  }

  const now = nowParam ? new Date(nowParam) : new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const dueDayStart = new Date(dueYear, dueMonth, dueDay, 0, 0, 0, 0);

  // Selisih hari kalender
  const diffTime = dueDayStart.getTime() - todayStart.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  const formatDueIndo = `${dueDay} ${['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'][dueMonth]} ${dueYear}`;

  if (isCompleted) {
    return {
      level: 'completed',
      label: `Target: ${formatDueIndo}`,
      badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
      icon: 'fa-solid fa-circle-check text-emerald-500',
      daysRemaining: diffDays,
      isUrgent: false
    };
  }

  if (diffDays < 0) {
    const overdueDays = Math.abs(diffDays);
    return {
      level: 'overdue',
      label: `Terlambat ${overdueDays} Hari (${formatDueIndo})`,
      badgeClass: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/70 dark:text-rose-200 dark:border-rose-800 shadow-2xs font-extrabold',
      icon: 'fa-solid fa-triangle-exclamation text-rose-600 animate-pulse',
      daysRemaining: diffDays,
      isUrgent: true
    };
  }

  if (diffDays === 0) {
    return {
      level: 'today',
      label: 'Batas Akhir: Hari Ini!',
      badgeClass: 'bg-amber-500 text-white border-amber-600 dark:bg-amber-600 dark:text-white shadow-2xs font-black animate-pulse',
      icon: 'fa-solid fa-fire text-amber-100',
      daysRemaining: 0,
      isUrgent: true
    };
  }

  if (diffDays === 1) {
    return {
      level: 'tomorrow',
      label: 'Batas Akhir: Besok (H-1)',
      badgeClass: 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-700 font-extrabold',
      icon: 'fa-solid fa-stopwatch text-amber-600',
      daysRemaining: 1,
      isUrgent: true
    };
  }

  if (diffDays <= 3) {
    return {
      level: 'soon',
      label: `H-${diffDays} Hari (${formatDueIndo})`,
      badgeClass: 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/50 dark:text-sky-200 dark:border-sky-800 font-bold',
      icon: 'fa-regular fa-clock text-sky-600',
      daysRemaining: diffDays,
      isUrgent: false
    };
  }

  return {
    level: 'normal',
    label: `Target: ${formatDueIndo}`,
    badgeClass: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 font-medium',
    icon: 'fa-regular fa-calendar-check text-slate-400',
    daysRemaining: diffDays,
    isUrgent: false
  };
}

/**
 * Render teks berformat Markdown secara aman (XSS-Proof / OWASP ASVS Level 2)
 * Pendekatan: Escape HTML entitas terlebih dahulu, kemudian lakukan transformasi sintaks semantik aman.
 * @param {string} rawMarkdown - Teks markdown mentah
 * @returns {string} Markup HTML terformat dan aman
 */
/**
 * Konversi fallback rumus TeX/matematika menjadi representasi HTML murni yang rapi
 * jika pustaka KaTeX belum dimuat atau dalam kondisi offline.
 * @param {string} tex Ekspresi matematika
 * @returns {string} HTML terformat (sup, sub, simbol Unicode)
 */
export function fallbackMathToHtml(tex) {
  if (!tex || typeof tex !== 'string') return '';
  let out = tex.trim();

  // 1. Pecahan sederhana \frac{a}{b}
  out = out.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '<span class="inline-flex flex-col text-center align-middle mx-0.5 text-[11px] leading-tight"><span class="border-b border-current pb-0.5">$1</span><span class="pt-0.5">$2</span></span>');

  // 2. Akar kuadrat \sqrt{x} atau \sqrt[n]{x}
  out = out.replace(/\\sqrt\[([^\]]+)\]\{([^{}]+)\}/g, '<sup>$1</sup>√($2)');
  out = out.replace(/\\sqrt\{([^{}]+)\}/g, '√($1)');

  // 3. Superskrip / Pangkat: ^{...} atau ^x
  out = out.replace(/\^{([^}]+)}/g, '<sup>$1</sup>');
  out = out.replace(/\^([0-9a-zA-Z+-]+)/g, '<sup>$1</sup>');

  // 4. Subskrip / Indeks: _{...} atau _x
  out = out.replace(/_{([^}]+)}/g, '<sub>$1</sub>');
  out = out.replace(/_([0-9a-zA-Z+-]+)/g, '<sub>$1</sub>');

  // 5. Simbol TeX matematika & sains umum
  const symbols = [
    [/\\pm/g, '±'],
    [/\\times/g, '×'],
    [/\\div/g, '÷'],
    [/\\cdot/g, '·'],
    [/\\leq?/g, '≤'],
    [/\\geq?/g, '≥'],
    [/\\neq?/g, '≠'],
    [/\\approx/g, '≈'],
    [/\\equiv/g, '≡'],
    [/\\infty/g, '∞'],
    [/\\pi/g, 'π'],
    [/\\alpha/g, 'α'],
    [/\\beta/g, 'β'],
    [/\\gamma/g, 'γ'],
    [/\\theta/g, 'θ'],
    [/\\lambda/g, 'λ'],
    [/\\mu/g, 'μ'],
    [/\\sigma/g, 'σ'],
    [/\\omega/g, 'ω'],
    [/\\Delta/g, 'Δ'],
    [/\\Sigma/g, 'Σ'],
    [/\\Omega/g, 'Ω'],
    [/\\degree|\\circ/g, '°'],
    [/\\rightarrow/g, '→'],
    [/\\leftarrow/g, '←']
  ];

  for (const [regex, replacement] of symbols) {
    out = out.replace(regex, replacement);
  }

  // Bersihkan backslash tersisa untuk simbol teks biasa
  out = out.replace(/\\([a-zA-Z]+)/g, '$1');

  return out;
}

/**
 * Render notasi matematika LaTeX ($...$, $...$, \(...\), \[...\])
 * Menggunakan KaTeX jika tersedia, atau fallback math renderer jika offline/belum termuat.
 * @param {string} text Teks mengandung ekspresi matematika
 * @returns {string} Markup HTML dengan matematika ter-render
 */
export function renderMathFormulas(text) {
  if (!text || typeof text !== 'string') return '';

  const hasKatex = typeof window !== 'undefined' && window.katex && typeof window.katex.renderToString === 'function';

  // 1. Display/Block Math: $...$ atau \[...\]
  let rendered = text.replace(/\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]/g, (_m, f1, f2) => {
    const raw = (f1 || f2 || '').trim();
    if (!raw) return '';
    const formula = raw.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'");
    if (hasKatex) {
      try {
        return `<div class="my-2.5 overflow-x-auto text-center">${window.katex.renderToString(formula, { displayMode: true, throwOnError: false })}</div>`;
      } catch (_) {}
    }
    return `<div class="my-2.5 p-2 bg-slate-50 dark:bg-slate-800/60 rounded-lg text-center font-mono text-sm border border-slate-200 dark:border-slate-700">${fallbackMathToHtml(formula)}</div>`;
  });

  // 2. Inline Math: $...$ atau \(...\)
  const renderInlineFormulaToken = rawFormula => {
    const raw = (rawFormula || '').trim();
    if (!raw) return '';
    const formula = raw.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'");
    if (hasKatex) {
      try {
        return window.katex.renderToString(formula, { displayMode: false, throwOnError: false });
      } catch (_) {}
    }
    return `<span class="inline-block px-1 font-mono text-[13px] bg-slate-100/70 dark:bg-slate-800/70 rounded">${fallbackMathToHtml(formula)}</span>`;
  };

  rendered = rendered.replace(/\$([^\$\n]+?)\$|\\\(([\s\S]*?)\\\)/g, (_m, f1, f2) => {
    return renderInlineFormulaToken(f1 || f2);
  });

  // 3. Standalone TeX expressions without $ delimiters (e.g. \frac{1}{3}, \sqrt{2}, etc.)
  rendered = rendered.replace(/(\\frac\{[^{}]+\}\{[^{}]+\}|\\sqrt(?:\[[^\]]+\])?\{[^{}]+\}|\\(?:pm|times|div|cdot|leq?|geq?|neq|approx|infty|pi|degree|alpha|beta|gamma|theta)\b)/g, (_m, f) => {
    return renderInlineFormulaToken(f);
  });

  return rendered;
}

export function renderSafeMarkdown(rawMarkdown) {
  if (!rawMarkdown || typeof rawMarkdown !== 'string') return '';

  // 1. Sanitasi entitas HTML secara mutlak terlebih dahulu
  let safe = rawMarkdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  // Izinkan tag sup dan sub yang sah
  safe = safe.replace(/&lt;(\/?)sup&gt;/gi, '<$1sup>').replace(/&lt;(\/?)sub&gt;/gi, '<$1sub>');

  // 2. Render ekspresi matematika (KaTeX / Fallback)
  safe = renderMathFormulas(safe);

  // 2. Format Code Blocks (```lang ... ```)
  safe = safe.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    const langLabel = lang ? `<span class="text-[10px] text-slate-400 font-mono block mb-1 uppercase tracking-wider">${lang}</span>` : '';
    return `<pre class="my-3 p-3.5 bg-slate-900 text-emerald-300 rounded-xl overflow-x-auto text-xs font-mono border border-slate-800 shadow-inner">${langLabel}<code>${code.trim()}</code></pre>`;
  });

  // 3. Format Inline Code (`code`)
  safe = safe.replace(/`([^`\n]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-pink-600 dark:text-pink-400 font-mono text-[11px] border border-slate-200 dark:border-slate-700">$1</code>');

  // 4. Format Blockquotes (> quote)
  safe = safe.replace(/^(?:&gt;|>)[ \t]?(.*)$/gm, '<blockquote class="my-2 pl-3 py-1 border-l-4 border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20 text-slate-600 dark:text-slate-300 italic rounded-r text-xs leading-relaxed">$1</blockquote>');

  // 5. Format Headings (#, ##, ###)
  safe = safe.replace(/^### (.*$)/gm, '<h5 class="text-xs sm:text-sm font-black text-slate-800 dark:text-slate-100 mt-3 mb-1.5 flex items-center gap-1.5"><i class="fa-solid fa-angle-right text-emerald-500 text-[10px]"></i>$1</h5>');
  safe = safe.replace(/^## (.*$)/gm, '<h4 class="text-sm sm:text-base font-black text-slate-900 dark:text-white mt-4 mb-2 pb-1 border-b border-slate-200/80 dark:border-slate-800 flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-emerald-500"></span>$1</h4>');
  safe = safe.replace(/^# (.*$)/gm, '<h3 class="text-base sm:text-lg font-black text-slate-900 dark:text-white mt-5 mb-2.5 flex items-center gap-2">$1</h3>');

  // 6. Horizontal Rules (--- or ***)
  safe = safe.replace(/^(?:---|\*\*\*)$/gm, '<hr class="my-3 border-t border-slate-200 dark:border-slate-800">');

  // 7. Format Bold & Italic & Strikethrough
  safe = safe.replace(/\*\*\*([^\*\n]+)\*\*\*/g, '<strong class="font-extrabold"><em class="italic">$1</em></strong>');
  safe = safe.replace(/\*\*([^\*\n]+)\*\*/g, '<strong class="font-bold text-slate-900 dark:text-white">$1</strong>');
  safe = safe.replace(/__([^_\n]+)__/g, '<strong class="font-bold text-slate-900 dark:text-white">$1</strong>');
  safe = safe.replace(/\*([^\*\n]+)\*/g, '<em class="italic">$1</em>');
  safe = safe.replace(/_([^_\n]+)_/g, '<em class="italic">$1</em>');
  safe = safe.replace(/~~([^~\n]+)~~/g, '<del class="line-through text-slate-400">$1</del>');

  // 8. Format Safe Links [label](https://...)
  safe = safe.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)"']+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="font-bold text-blue-600 dark:text-blue-400 underline hover:text-blue-700 dark:hover:text-blue-300 inline-flex items-center gap-1">$1 <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i></a>');

  // 9. Format Unordered Lists (- item or * item) & Ordered Lists (1. item)
  safe = safe.replace(/^[\*-][ \t]+(.*)$/gm, '<li class="ml-4 list-disc text-xs text-slate-700 dark:text-slate-300 leading-relaxed">$1</li>');
  safe = safe.replace(/^[0-9]+\.[ \t]+(.*)$/gm, '<li class="ml-4 list-decimal text-xs text-slate-700 dark:text-slate-300 leading-relaxed">$1</li>');

  // Wrap consecutive <li> into <ul>/<ol>
  safe = safe.replace(/(<li class="ml-4 list-disc[^>]*>[\s\S]*?<\/li>(\s*<li class="ml-4 list-disc[^>]*>[\s\S]*?<\/li>)*)/g, '<ul class="my-2 space-y-1 pl-1">$1</ul>');
  safe = safe.replace(/(<li class="ml-4 list-decimal[^>]*>[\s\S]*?<\/li>(\s*<li class="ml-4 list-decimal[^>]*>[\s\S]*?<\/li>)*)/g, '<ol class="my-2 space-y-1 pl-1">$1</ol>');

  // 10. Paragraf & Newlines
  const paragraphs = safe.split(/\n\s*\n/);
  const rendered = paragraphs.map(p => {
    const trimmed = p.trim();
    if (!trimmed) return '';
    if (/^<(h[3-5]|ul|ol|pre|blockquote|hr)/i.test(trimmed)) {
      return trimmed;
    }
    return `<p class="my-1.5 leading-relaxed">${trimmed.replace(/\n/g, '<br>')}</p>`;
  }).filter(Boolean).join('\n');

  return rendered;
}

// =========================================================================
// SMART CARD QR CODE PARSER (Buku Tamu Perpus, Kasir SPP, Modul Pencarian Siswa)
// Kunci token kartu (kts_) sengaja TIDAK ada di browser: siapa pun yang memegangnya dapat membuat
// token untuk NIS mana saja. Token dari QR diterjemahkan oleh Worker (khusus staf yang login).
// =========================================================================

function readQrIdParam(input) {
  if (!(input.includes('kartu-shakti.html') || input.includes('?id=') || input.includes('&id=') || input.includes('?nis=') || input.includes('&nis='))) {
    return { id: '', nis: '' };
  }
  try {
    const dummyBase = "https://simas-demo-5ead3.web.app";
    const fullUrl = input.startsWith('http') ? input : `${dummyBase}/${input.replace(/^\/+/, '')}`;
    const urlObj = new URL(fullUrl);
    return {
      id: decodeURIComponent(urlObj.searchParams.get('id') || '').trim(),
      nis: decodeURIComponent(urlObj.searchParams.get('nis') || '').trim()
    };
  } catch {
    const matchId = input.match(/[?&]id=([^&#\s]+)/);
    const matchNis = input.match(/[?&]nis=([^&#\s]+)/);
    return {
      id: matchId ? decodeURIComponent(matchId[1]).trim() : '',
      nis: matchNis ? decodeURIComponent(matchNis[1]).trim() : ''
    };
  }
}

/**
 * Mengambil token kartu dari hasil scan: URL kartu-shakti.html?id=<token> atau token kts_ polos.
 * @param {string} rawInput
 * @returns {string} Token kartu, atau '' bila input bukan QR kartu
 */
export function extractCardTokenFromQrInput(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') return '';
  const input = rawInput.trim();
  if (input.startsWith('kts_')) return input;
  const { id } = readQrIdParam(input);
  if (id && !/^\d{3,12}$/.test(id)) return id;
  return '';
}

/**
 * Smart Auto-Parser sinkron: mengekstrak NIS yang tertulis langsung pada hasil scan.
 * Mendukung angka NIS polos (barcode 1D) dan URL legacy (?nis= / ?id=<NIS>).
 * Token kartu (kts_ / public token) TIDAK dapat diterjemahkan di browser; gunakan resolveNisFromQrInput.
 * @param {string} rawInput
 * @returns {string} Nomor NIS yang terekstraksi atau string asli yang sudah di-trim
 */
export function extractNisFromQrInput(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') return '';
  let input = rawInput.trim();

  const { id, nis } = readQrIdParam(input);
  if (id) input = id;
  else if (nis) input = nis;

  const numericMatch = input.match(/^\d{3,12}$/);
  if (numericMatch) {
    return numericMatch[0];
  }

  return input;
}

/**
 * Menerjemahkan hasil scan menjadi NIS. Token kartu dikirim ke Worker (/api/students/resolve-card),
 * selain itu memakai extractNisFromQrInput.
 * @param {string} rawInput
 * @param {object} [client] - CloudflareClient; default window.cfClient
 * @returns {Promise<string>} NIS, atau '' bila token kartu tidak dikenali
 */
export async function resolveNisFromQrInput(rawInput, client = (typeof window !== 'undefined' ? window.cfClient : null)) {
  const token = extractCardTokenFromQrInput(rawInput);
  if (!token) return extractNisFromQrInput(rawInput);
  if (!client || typeof client.resolveStudentCardToken !== 'function') return '';
  try {
    const result = await client.resolveStudentCardToken(token);
    return String(result?.data?.nis || '').trim();
  } catch (error) {
    console.warn('[QR Kartu] Token kartu tidak dapat diterjemahkan:', error?.message || error);
    return '';
  }
}

/**
 * Scanner barcode mengetik hasil scan karakter demi karakter (satu event input per karakter).
 * Tunggu sejenak lalu pastikan nilai input tidak berubah, agar hanya hasil scan lengkap yang
 * dikirim ke Worker (bukan puluhan token setengah jadi).
 * @param {HTMLInputElement} inputEl
 * @param {string} value - nilai (trim) saat event input terjadi
 * @param {number} [ms]
 * @returns {Promise<boolean>} true bila nilai masih sama setelah jeda
 */
export async function isQrInputSettled(inputEl, value, ms = 250) {
  await new Promise(resolve => setTimeout(resolve, ms));
  return !inputEl || String(inputEl.value || '').trim() === value;
}

if (typeof window !== 'undefined') {
  window.isClassEqual = isClassEqual;
  window.calculateDueDateUrgency = calculateDueDateUrgency;
  window.renderSafeMarkdown = renderSafeMarkdown;
  window.renderMathFormulas = renderMathFormulas;
  window.fallbackMathToHtml = fallbackMathToHtml;
  window.extractNisFromQrInput = extractNisFromQrInput;
  window.extractCardTokenFromQrInput = extractCardTokenFromQrInput;
  window.resolveNisFromQrInput = resolveNisFromQrInput;
}



