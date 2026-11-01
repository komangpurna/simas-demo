import { renderSafeMarkdown } from './utils.mjs';

let activePopoverCleanup = null;
let currentTargetInput = null;

export function closeLmsMathPalette() {
    if (typeof activePopoverCleanup === 'function') {
        activePopoverCleanup();
        activePopoverCleanup = null;
    }
    document.getElementById('lms-math-palette-popover')?.remove();
    currentTargetInput = null;
}

export function openLmsMathPaletteModal(targetInput, onUpdate = null, triggerElement = null) {
    if (!targetInput) return null;

    // Toggle behavior: jika popover aktif sedang terkait dengan targetInput yang sama, tutup
    if (currentTargetInput === targetInput && document.getElementById('lms-math-palette-popover')) {
        closeLmsMathPalette();
        return null;
    }

    closeLmsMathPalette();
    currentTargetInput = targetInput;

    const anchorEl = triggerElement || targetInput;
    const popover = document.createElement('div');
    popover.id = 'lms-math-palette-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', 'Palet Simbol & Rumus Matematika (LaTeX)');
    popover.className = 'fixed z-[130] bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden text-xs transition-all duration-150';
    popover.style.width = '340px';
    popover.style.maxWidth = 'calc(100vw - 20px)';
    popover.style.maxHeight = '420px';

    // Perhitungan posisi cerdas (Smart Floating Position)
    function updatePosition() {
        if (!anchorEl || !anchorEl.isConnected) return;
        const rect = anchorEl.getBoundingClientRect();
        const popoverWidth = Math.min(340, window.innerWidth - 20);
        let left = rect.left;
        if (left + popoverWidth > window.innerWidth - 10) {
            left = window.innerWidth - popoverWidth - 10;
        }
        if (left < 10) left = 10;

        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        const estimatedHeight = 390;

        let top;
        if (spaceBelow < estimatedHeight && spaceAbove > spaceBelow) {
            top = Math.max(10, rect.top - estimatedHeight - 6);
        } else {
            top = Math.min(window.innerHeight - estimatedHeight - 10, rect.bottom + 6);
        }

        popover.style.left = `${Math.round(left)}px`;
        popover.style.top = `${Math.round(top)}px`;
    }

    const btnClass = 'px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-purple-50 dark:hover:bg-purple-950/40 hover:border-purple-300 dark:hover:border-purple-700 text-slate-800 dark:text-slate-200 font-mono text-xs transition font-semibold flex items-center justify-center shrink-0 active:scale-95';
    const tabClassActive = 'flex-1 py-1.5 text-center font-bold text-xs border-b-2 border-purple-600 text-purple-600 dark:text-purple-400 bg-purple-50/50 dark:bg-purple-950/20 transition';
    const tabClassInactive = 'flex-1 py-1.5 text-center font-medium text-xs border-b-2 border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition';

    popover.innerHTML = `
        <!-- Header Popover -->
        <div class="p-2.5 px-3 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/80 dark:bg-slate-800/50 shrink-0">
            <span class="font-extrabold flex items-center gap-1.5 text-purple-700 dark:text-purple-300">
                <i class="fa-solid fa-square-root-variable text-sm"></i>
                <span>Simbol &amp; Rumus Matematika</span>
            </span>
            <button type="button" data-action="close-popover" class="w-6 h-6 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex items-center justify-center transition" title="Tutup" aria-label="Tutup palet matematika">
                <i class="fa-solid fa-xmark text-xs"></i>
            </button>
        </div>

        <!-- Tab Switcher (Opsi A: Simbol Cepat vs Opsi B: Pembuat Rumus) -->
        <div class="flex border-b border-slate-100 dark:border-slate-800 shrink-0">
            <button type="button" data-tab-btn="quick" class="${tabClassActive}">
                <i class="fa-solid fa-bolt text-[11px] mr-1"></i> Simbol Cepat
            </button>
            <button type="button" data-tab-btn="builder" class="${tabClassInactive}">
                <i class="fa-solid fa-wand-magic-sparkles text-[11px] mr-1"></i> Pembuat Rumus
            </button>
        </div>

        <!-- Body Content -->
        <div class="p-3 overflow-y-auto space-y-3 flex-1 custom-scrollbar">
            <!-- TAB 1: SIMBOL CEPAT (1-KLIK LANGSUNG MASUK) -->
            <div data-tab-panel="quick" class="space-y-3">
                <p class="text-[11px] text-slate-500 dark:text-slate-400">Klik simbol di bawah untuk menyisipkan ke posisi kursor teks.</p>
                
                <div class="space-y-1">
                    <b class="text-[10px] uppercase font-bold text-slate-400">Operasi &amp; Relasi</b>
                    <div class="grid grid-cols-6 gap-1">
                        <button type="button" data-insert-math="±" class="${btnClass}">±</button>
                        <button type="button" data-insert-math="×" class="${btnClass}">×</button>
                        <button type="button" data-insert-math="÷" class="${btnClass}">÷</button>
                        <button type="button" data-insert-math="·" class="${btnClass}">·</button>
                        <button type="button" data-insert-math="√" class="${btnClass}">√</button>
                        <button type="button" data-insert-math="≤" class="${btnClass}">≤</button>
                        <button type="button" data-insert-math="≥" class="${btnClass}">≥</button>
                        <button type="button" data-insert-math="≠" class="${btnClass}">≠</button>
                        <button type="button" data-insert-math="≈" class="${btnClass}">≈</button>
                        <button type="button" data-insert-math="≡" class="${btnClass}">≡</button>
                        <button type="button" data-insert-math="∝" class="${btnClass}">∝</button>
                        <button type="button" data-insert-math="∞" class="${btnClass}">∞</button>
                    </div>
                </div>

                <div class="space-y-1">
                    <b class="text-[10px] uppercase font-bold text-slate-400">Geometri &amp; Pangkat</b>
                    <div class="grid grid-cols-6 gap-1">
                        <button type="button" data-insert-math="π" class="${btnClass}">π</button>
                        <button type="button" data-insert-math="°" class="${btnClass}">°</button>
                        <button type="button" data-insert-math="∠" class="${btnClass}">∠</button>
                        <button type="button" data-insert-math="△" class="${btnClass}">△</button>
                        <button type="button" data-insert-math="⟂" class="${btnClass}">⟂</button>
                        <button type="button" data-insert-math="∥" class="${btnClass}">∥</button>
                        <button type="button" data-insert-math="x²" class="${btnClass}">x²</button>
                        <button type="button" data-insert-math="x³" class="${btnClass}">x³</button>
                        <button type="button" data-insert-math="x₁" class="${btnClass}">x₁</button>
                        <button type="button" data-insert-math="x₂" class="${btnClass}">x₂</button>
                        <button type="button" data-insert-math="$\\frac{a}{b}$" title="Pecahan a/b" class="${btnClass} !text-[10px]">a/b</button>
                        <button type="button" data-insert-math="$\\sin(x)$" class="${btnClass} !text-[10px]">sin</button>
                        <button type="button" data-insert-math="$\\cos(x)$" class="${btnClass} !text-[10px]">cos</button>
                    </div>
                </div>

                <div class="space-y-1">
                    <b class="text-[10px] uppercase font-bold text-slate-400">Huruf Yunani &amp; Himpunan</b>
                    <div class="grid grid-cols-6 gap-1">
                        <button type="button" data-insert-math="α" class="${btnClass}">α</button>
                        <button type="button" data-insert-math="β" class="${btnClass}">β</button>
                        <button type="button" data-insert-math="γ" class="${btnClass}">γ</button>
                        <button type="button" data-insert-math="θ" class="${btnClass}">θ</button>
                        <button type="button" data-insert-math="λ" class="${btnClass}">λ</button>
                        <button type="button" data-insert-math="μ" class="${btnClass}">μ</button>
                        <button type="button" data-insert-math="Δ" class="${btnClass}">Δ</button>
                        <button type="button" data-insert-math="Ω" class="${btnClass}">Ω</button>
                        <button type="button" data-insert-math="∈" class="${btnClass}">∈</button>
                        <button type="button" data-insert-math="∉" class="${btnClass}">∉</button>
                        <button type="button" data-insert-math="⊂" class="${btnClass}">⊂</button>
                        <button type="button" data-insert-math="∪" class="${btnClass}">∪</button>
                    </div>
                </div>
            </div>

            <!-- TAB 2: PEMBUAT RUMUS BERSTRUKTUR (FORMULA BUILDER - OPSI B) -->
            <div data-tab-panel="builder" class="space-y-2.5 hidden">
                <div class="space-y-1">
                    <label class="block font-bold text-[11px] text-slate-600 dark:text-slate-300">Pilih Tipe Rumus:</label>
                    <select data-builder-select class="w-full p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold outline-none focus:ring-2 focus:ring-purple-500">
                        <option value="fraction">Pecahan (A / B)</option>
                        <option value="root">Akar (√ atau ⁿ√)</option>
                        <option value="power">Pangkat &amp; Indeks (Xⁿ / Xₘ)</option>
                        <option value="integral">Integral (∫)</option>
                        <option value="limit">Limit (lim)</option>
                    </select>
                </div>

                <!-- Form Isian Dinamis Sesuai Tipe Rumus -->
                <div data-builder-form-container class="space-y-2 pt-1">
                    <!-- Dynamic Fields -->
                </div>

                <!-- Area Pratinjau Visual Hasil Rumus Realtime -->
                <div class="p-2.5 rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50/60 dark:bg-purple-950/20 space-y-1">
                    <span class="block text-[10px] font-bold text-purple-900 dark:text-purple-300 uppercase tracking-wide">Pratinjau Hasil Rumus:</span>
                    <div data-builder-preview class="p-2 rounded-lg bg-white dark:bg-slate-900 border border-purple-100 dark:border-purple-900/60 min-h-[38px] text-center flex items-center justify-center text-sm font-semibold overflow-x-auto">
                        <!-- KaTeX Live Render -->
                    </div>
                </div>

                <!-- Tombol Aksi Sisip Rumus -->
                <button type="button" data-action="insert-built-formula" class="w-full py-2 bg-purple-600 hover:bg-purple-500 text-white font-extrabold rounded-xl shadow text-xs transition active:scale-95 flex items-center justify-center gap-1.5">
                    <i class="fa-solid fa-plus-circle text-xs"></i>
                    <span>Sisipkan Rumus ke Teks</span>
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(popover);
    updatePosition();

    // Helper: Sisipkan teks ke posisi kursor textarea
    const insertSnippetAtCursor = snippet => {
        if (!snippet) return;
        const start = targetInput.selectionStart ?? targetInput.value.length;
        const end = targetInput.selectionEnd ?? targetInput.value.length;
        const before = targetInput.value.slice(0, start);
        const after = targetInput.value.slice(end);
        targetInput.value = before + snippet + after;
        const newPos = start + snippet.length;
        targetInput.focus();
        targetInput.setSelectionRange?.(newPos, newPos);
        targetInput.dispatchEvent(new Event('input', { bubbles: true }));
        targetInput.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof onUpdate === 'function') onUpdate();
    };

    // Tab Navigation Logic
    const tabQuickBtn = popover.querySelector('[data-tab-btn="quick"]');
    const tabBuilderBtn = popover.querySelector('[data-tab-btn="builder"]');
    const panelQuick = popover.querySelector('[data-tab-panel="quick"]');
    const panelBuilder = popover.querySelector('[data-tab-panel="builder"]');

    const switchTab = toBuilder => {
        tabQuickBtn.className = toBuilder ? tabClassInactive : tabClassActive;
        tabBuilderBtn.className = toBuilder ? tabClassActive : tabClassInactive;
        panelQuick.classList.toggle('hidden', toBuilder);
        panelBuilder.classList.toggle('hidden', !toBuilder);
        if (toBuilder) {
            updateBuilderForm();
        }
        updatePosition();
    };

    tabQuickBtn.onclick = () => switchTab(false);
    tabBuilderBtn.onclick = () => switchTab(true);

    // Tab 1: Click Quick Symbol Buttons
    panelQuick.querySelectorAll('button[data-insert-math]').forEach(btn => {
        btn.onclick = () => {
            const math = btn.dataset.insertMath;
            insertSnippetAtCursor(math);
        };
    });

    // Tab 2: Formula Builder Logic (Opsi B)
    const builderSelect = popover.querySelector('[data-builder-select]');
    const builderFormContainer = popover.querySelector('[data-builder-form-container]');
    const builderPreview = popover.querySelector('[data-builder-preview]');
    const insertBuiltBtn = popover.querySelector('[data-action="insert-built-formula"]');

    let currentBuiltTeX = '';

    const updateBuilderForm = () => {
        const type = builderSelect.value;
        const inputClass = 'w-full p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-800 dark:text-slate-100 font-medium outline-none focus:ring-2 focus:ring-purple-500';

        if (type === 'fraction') {
            builderFormContainer.innerHTML = `
                <div class="grid grid-cols-2 gap-2">
                    <label class="block space-y-1">
                        <span class="text-[10px] font-bold text-slate-500 uppercase">Pembilang (atas)</span>
                        <input type="text" data-field="num" value="1" placeholder="Misal: 3x+1" class="${inputClass}">
                    </label>
                    <label class="block space-y-1">
                        <span class="text-[10px] font-bold text-slate-500 uppercase">Penyebut (bawah)</span>
                        <input type="text" data-field="den" value="2" placeholder="Misal: 4" class="${inputClass}">
                    </label>
                </div>
            `;
        } else if (type === 'root') {
            builderFormContainer.innerHTML = `
                <div class="grid grid-cols-2 gap-2">
                    <label class="block space-y-1">
                        <span class="text-[10px] font-bold text-slate-500 uppercase">Pangkat akar (opsional)</span>
                        <input type="text" data-field="root_deg" value="" placeholder="Kosongkan jika √2" class="${inputClass}">
                    </label>
                    <label class="block space-y-1">
                        <span class="text-[10px] font-bold text-slate-500 uppercase">Bilangan dalam akar</span>
                        <input type="text" data-field="root_val" value="x" placeholder="Misal: 144" class="${inputClass}">
                    </label>
                </div>
            `;
        } else if (type === 'power') {
            builderFormContainer.innerHTML = `
                <div class="grid grid-cols-3 gap-1.5">
                    <label class="block space-y-1">
                        <span class="text-[10px] font-bold text-slate-500 uppercase">Variabel</span>
                        <input type="text" data-field="pow_base" value="x" placeholder="x" class="${inputClass}">
                    </label>
                    <label class="block space-y-1">
                        <span class="text-[10px] font-bold text-slate-500 uppercase">Pangkat (atas)</span>
                        <input type="text" data-field="pow_exp" value="2" placeholder="2" class="${inputClass}">
                    </label>
                    <label class="block space-y-1">
                        <span class="text-[10px] font-bold text-slate-500 uppercase">Indeks (bawah)</span>
                        <input type="text" data-field="pow_sub" value="" placeholder="opsional" class="${inputClass}">
                    </label>
                </div>
            `;
        } else if (type === 'integral') {
            builderFormContainer.innerHTML = `
                <div class="grid grid-cols-3 gap-1.5">
                    <label class="block space-y-1">
                        <span class="text-[10px] font-bold text-slate-500 uppercase">Batas Bawah</span>
                        <input type="text" data-field="int_a" value="a" placeholder="a" class="${inputClass}">
                    </label>
                    <label class="block space-y-1">
                        <span class="text-[10px] font-bold text-slate-500 uppercase">Batas Atas</span>
                        <input type="text" data-field="int_b" value="b" placeholder="b" class="${inputClass}">
                    </label>
                    <label class="block space-y-1">
                        <span class="text-[10px] font-bold text-slate-500 uppercase">Fungsi</span>
                        <input type="text" data-field="int_fn" value="f(x)\\,dx" placeholder="f(x) dx" class="${inputClass}">
                    </label>
                </div>
            `;
        } else if (type === 'limit') {
            builderFormContainer.innerHTML = `
                <div class="grid grid-cols-2 gap-2">
                    <label class="block space-y-1">
                        <span class="text-[10px] font-bold text-slate-500 uppercase">Mendekati</span>
                        <input type="text" data-field="lim_to" value="x \\to 0" placeholder="x \\to 0" class="${inputClass}">
                    </label>
                    <label class="block space-y-1">
                        <span class="text-[10px] font-bold text-slate-500 uppercase">Fungsi</span>
                        <input type="text" data-field="lim_fn" value="f(x)" placeholder="f(x)" class="${inputClass}">
                    </label>
                </div>
            `;
        }

        const inputs = builderFormContainer.querySelectorAll('input');
        inputs.forEach(inp => {
            inp.oninput = updateBuilderPreview;
        });
        updateBuilderPreview();
    };

    const updateBuilderPreview = () => {
        const type = builderSelect.value;
        const val = field => (builderFormContainer.querySelector(`[data-field="${field}"]`)?.value || '').trim();

        if (type === 'fraction') {
            const num = val('num') || 'a';
            const den = val('den') || 'b';
            currentBuiltTeX = `$\\frac{${num}}{${den}}$`;
        } else if (type === 'root') {
            const deg = val('root_deg');
            const v = val('root_val') || 'x';
            currentBuiltTeX = deg ? `$\\sqrt[${deg}]{${v}}$` : `$\\sqrt{${v}}$`;
        } else if (type === 'power') {
            const base = val('pow_base') || 'x';
            const exp = val('pow_exp');
            const sub = val('pow_sub');
            let formula = base;
            if (sub) formula += `_{${sub}}`;
            if (exp) formula += `^{${exp}}`;
            currentBuiltTeX = `$${formula}$`;
        } else if (type === 'integral') {
            const a = val('int_a');
            const b = val('int_b');
            const fn = val('int_fn') || 'f(x)\\,dx';
            currentBuiltTeX = (a || b) ? `$\\int_{${a || ''}}^{${b || ''}} ${fn}$` : `$\\int ${fn}$`;
        } else if (type === 'limit') {
            const to = val('lim_to') || 'x \\to 0';
            const fn = val('lim_fn') || 'f(x)';
            currentBuiltTeX = `$\\lim_{${to}} ${fn}$`;
        }

        builderPreview.innerHTML = renderSafeMarkdown(currentBuiltTeX);
    };

    builderSelect.onchange = updateBuilderForm;

    insertBuiltBtn.onclick = () => {
        if (!currentBuiltTeX) return;
        insertSnippetAtCursor(currentBuiltTeX);
        // Visual feedback
        const oldText = insertBuiltBtn.innerHTML;
        insertBuiltBtn.classList.replace('bg-purple-600', 'bg-emerald-600');
        insertBuiltBtn.innerHTML = '<i class="fa-solid fa-check text-xs"></i> <span>Tersisip!</span>';
        setTimeout(() => {
            if (insertBuiltBtn && insertBuiltBtn.isConnected) {
                insertBuiltBtn.classList.replace('bg-emerald-600', 'bg-purple-600');
                insertBuiltBtn.innerHTML = oldText;
            }
        }, 1000);
    };

    // Close button
    popover.querySelector('[data-action="close-popover"]').onclick = closeLmsMathPalette;

    // Click outside listener (pointerdown) & ESC keydown listener
    const onWindowPointerDown = e => {
        if (!popover.isConnected) return;
        if (popover.contains(e.target)) return;
        if (anchorEl && anchorEl.contains(e.target)) return;
        closeLmsMathPalette();
    };

    const onWindowKeyDown = e => {
        if (e.key === 'Escape') {
            closeLmsMathPalette();
        }
    };

    const onWindowResizeOrScroll = () => {
        if (!popover.isConnected) return;
        updatePosition();
    };

    window.addEventListener('pointerdown', onWindowPointerDown, true);
    window.addEventListener('keydown', onWindowKeyDown, true);
    window.addEventListener('resize', onWindowResizeOrScroll);
    window.addEventListener('scroll', onWindowResizeOrScroll, true);

    activePopoverCleanup = () => {
        window.removeEventListener('pointerdown', onWindowPointerDown, true);
        window.removeEventListener('keydown', onWindowKeyDown, true);
        window.removeEventListener('resize', onWindowResizeOrScroll);
        window.removeEventListener('scroll', onWindowResizeOrScroll, true);
    };

    return popover;
}

if (typeof window !== 'undefined') {
    window.openLmsMathPaletteModal = openLmsMathPaletteModal;
    window.closeLmsMathPalette = closeLmsMathPalette;
}
