/**
 * js/utils-photo-dnd.mjs
 * Utilitas Terpadu Drag-and-Drop & Touch Gesture Pengurutan Foto Bukti Realisasi
 * Mendukung Mouse Desktop (HTML5 Drag API) & Layar Sentuh Mobile / Android TWA (Pointer Events).
 * SSOT: Reordering berbasis indeks array murni dengan preservasi state objek utuh.
 */

/**
 * Mengatur ulang urutan item dalam array secara aman (immutable clone)
 * @template T
 * @param {T[]} array - Array sumber
 * @param {number} fromIndex - Indeks asal
 * @param {number} toIndex - Indeks tujuan
 * @returns {T[]} Array baru hasil pengurutan
 */
export function reorderArrayItems(array, fromIndex, toIndex) {
    if (!Array.isArray(array)) return [];
    const len = array.length;
    if (len <= 1) return [...array];
    if (
        fromIndex === toIndex ||
        fromIndex < 0 || toIndex < 0 ||
        fromIndex >= len || toIndex >= len ||
        !Number.isInteger(fromIndex) || !Number.isInteger(toIndex)
    ) {
        return [...array];
    }

    const next = [...array];
    const [movedItem] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, movedItem);
    return next;
}

/**
 * Menghubungkan interaksi Drag-and-Drop & Sentuh pada Grid Kartu Foto
 * @param {HTMLElement} gridContainer - Kontainer grid kartu foto
 * @param {Object} options
 * @param {string} [options.handleSelector='.photo-drag-handle'] - Selector elemen grip geser
 * @param {string} [options.cardSelector='.photo-card-item'] - Selector kartu foto
 * @param {function(number, number): void} options.onReorder - Callback saat posisi berubah: (fromIndex, toIndex) => void
 * @returns {function(): void} Fungsi pembersih listener (cleanup)
 */
export function setupPhotoGridDragAndDrop(gridContainer, options = {}) {
    if (!gridContainer || typeof options.onReorder !== 'function') {
        return () => {};
    }

    const handleSelector = options.handleSelector || '.photo-drag-handle';
    const cardSelector = options.cardSelector || '.photo-card-item';
    const onReorder = options.onReorder;

    const cards = Array.from(gridContainer.querySelectorAll(cardSelector));
    if (cards.length <= 1) return () => {};

    let draggedCard = null;
    let draggedIndex = -1;

    // Bersihkan highlight styling pada seluruh kartu
    const clearHighlights = () => {
        cards.forEach(card => {
            card.classList.remove(
                'opacity-50', 'scale-95', 'ring-2', 'ring-purple-500',
                'border-purple-500', 'dark:border-purple-400', 'bg-purple-50/20'
            );
        });
    };

    // =========================================================================
    // 1. DESKTOP HTML5 DRAG & DROP (Mouse)
    // =========================================================================
    const handleDragStart = (e) => {
        const card = e.currentTarget;
        if (!card) return;

        // Hanya izinkan drag jika dipicu dari handle atau thumbnail (bukan input/button teks)
        if (e.target.closest('input, textarea, button:not(' + handleSelector + ')')) {
            e.preventDefault();
            return;
        }

        const idx = parseInt(card.dataset.photoIndex, 10);
        if (isNaN(idx)) {
            e.preventDefault();
            return;
        }

        draggedCard = card;
        draggedIndex = idx;

        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            try {
                e.dataTransfer.setData('text/plain', String(idx));
            } catch (_) {}
        }

        requestAnimationFrame(() => {
            if (draggedCard) {
                draggedCard.classList.add('opacity-50', 'scale-95', 'ring-2', 'ring-purple-500');
            }
        });
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        const card = e.currentTarget;
        if (card && card !== draggedCard) {
            card.classList.add('border-purple-500', 'dark:border-purple-400', 'bg-purple-50/20');
        }
    };

    const handleDragLeave = (e) => {
        const card = e.currentTarget;
        if (card && card !== draggedCard) {
            card.classList.remove('border-purple-500', 'dark:border-purple-400', 'bg-purple-50/20');
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        const card = e.currentTarget;
        clearHighlights();

        if (!card) return;
        const targetIndex = parseInt(card.dataset.photoIndex, 10);

        let sourceIndex = draggedIndex;
        if (e.dataTransfer) {
            const dataIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
            if (!isNaN(dataIdx)) sourceIndex = dataIdx;
        }

        draggedCard = null;
        draggedIndex = -1;

        if (!isNaN(sourceIndex) && !isNaN(targetIndex) && sourceIndex !== targetIndex) {
            onReorder(sourceIndex, targetIndex);
        }
    };

    const handleDragEnd = () => {
        draggedCard = null;
        draggedIndex = -1;
        clearHighlights();
    };

    // =========================================================================
    // 2. MOBILE TOUCH & POINTER GESTURES (Layar Sentuh & TWA Android)
    // =========================================================================
    let activePointerId = null;
    let touchSourceCard = null;
    let touchSourceIndex = -1;
    let currentHoverTargetCard = null;

    const handlePointerDown = (e) => {
        const handle = e.target.closest(handleSelector);
        if (!handle) return;

        const card = handle.closest(cardSelector);
        if (!card) return;

        const idx = parseInt(card.dataset.photoIndex, 10);
        if (isNaN(idx)) return;

        activePointerId = e.pointerId;
        touchSourceCard = card;
        touchSourceIndex = idx;

        try {
            handle.setPointerCapture(e.pointerId);
        } catch (_) {}

        touchSourceCard.classList.add('opacity-60', 'scale-95', 'ring-2', 'ring-purple-500');
    };

    const handlePointerMove = (e) => {
        if (activePointerId === null || e.pointerId !== activePointerId || !touchSourceCard) return;

        const elUnderPoint = document.elementFromPoint(e.clientX, e.clientY);
        const hoverCard = elUnderPoint ? elUnderPoint.closest(cardSelector) : null;

        if (hoverCard !== currentHoverTargetCard) {
            if (currentHoverTargetCard && currentHoverTargetCard !== touchSourceCard) {
                currentHoverTargetCard.classList.remove('border-purple-500', 'dark:border-purple-400', 'bg-purple-50/20');
            }
            currentHoverTargetCard = hoverCard;
            if (currentHoverTargetCard && currentHoverTargetCard !== touchSourceCard) {
                currentHoverTargetCard.classList.add('border-purple-500', 'dark:border-purple-400', 'bg-purple-50/20');
            }
        }
    };

    const finishPointerDrag = (e) => {
        if (activePointerId === null || e.pointerId !== activePointerId) return;

        const handle = e.target.closest(handleSelector);
        if (handle) {
            try {
                handle.releasePointerCapture(e.pointerId);
            } catch (_) {}
        }

        const fromIdx = touchSourceIndex;
        let toIdx = -1;

        if (currentHoverTargetCard) {
            const parsed = parseInt(currentHoverTargetCard.dataset.photoIndex, 10);
            if (!isNaN(parsed)) toIdx = parsed;
        } else {
            const elUnderPoint = document.elementFromPoint(e.clientX, e.clientY);
            const dropCard = elUnderPoint ? elUnderPoint.closest(cardSelector) : null;
            if (dropCard) {
                const parsed = parseInt(dropCard.dataset.photoIndex, 10);
                if (!isNaN(parsed)) toIdx = parsed;
            }
        }

        activePointerId = null;
        touchSourceCard = null;
        touchSourceIndex = -1;
        currentHoverTargetCard = null;
        clearHighlights();

        if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
            onReorder(fromIdx, toIdx);
        }
    };

    cards.forEach(card => {
        card.setAttribute('draggable', 'true');
        card.addEventListener('dragstart', handleDragStart);
        card.addEventListener('dragover', handleDragOver);
        card.addEventListener('dragleave', handleDragLeave);
        card.addEventListener('drop', handleDrop);
        card.addEventListener('dragend', handleDragEnd);

        const handle = card.querySelector(handleSelector);
        if (handle) {
            handle.addEventListener('pointerdown', handlePointerDown);
            handle.addEventListener('pointermove', handlePointerMove);
            handle.addEventListener('pointerup', finishPointerDrag);
            handle.addEventListener('pointercancel', finishPointerDrag);
        }
    });

    return () => {
        cards.forEach(card => {
            card.removeEventListener('dragstart', handleDragStart);
            card.removeEventListener('dragover', handleDragOver);
            card.removeEventListener('dragleave', handleDragLeave);
            card.removeEventListener('drop', handleDrop);
            card.removeEventListener('dragend', handleDragEnd);

            const handle = card.querySelector(handleSelector);
            if (handle) {
                handle.removeEventListener('pointerdown', handlePointerDown);
                handle.removeEventListener('pointermove', handlePointerMove);
                handle.removeEventListener('pointerup', finishPointerDrag);
                handle.removeEventListener('pointercancel', finishPointerDrag);
            }
        });
    };
}
