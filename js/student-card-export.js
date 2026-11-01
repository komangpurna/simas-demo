// DOM-to-PNG adapter. Card content and design belong to student-card-renderer.js
// and card-print.css; no card layout is drawn here.
import { getCardFontCss } from './student-card-fonts.js';
let exporterPromise;
async function getExporter() {
    if (!exporterPromise) {
        exporterPromise = import('./vendor/html-to-image.js').then(() => globalThis.htmlToImage)
            .catch(error => { exporterPromise = null; throw error; });
    }
    return exporterPromise;
}

function copyRenderedMedia(source, clone) {
    if (source.nodeType !== 1) return;
    if (source instanceof HTMLCanvasElement) {
        clone.width = source.width;
        clone.height = source.height;
        clone.getContext('2d').drawImage(source, 0, 0);
    }
    if (source instanceof HTMLImageElement) {
        clone.removeAttribute('srcset');
        clone.src = source.currentSrc || source.src;
    }
    Array.from(source.children).forEach((child, index) => copyRenderedMedia(child, clone.children[index]));
}

const staticImageCache = new Map();

export function clearStaticImageCache() {
    staticImageCache.clear();
}

async function embedImages(face) {
    await Promise.all(Array.from(face.querySelectorAll('img')).map(async img => {
        const url = img.src;
        if (!url.startsWith('data:')) {
            if (!staticImageCache.has(url)) {
                const pending = (async () => {
                    const response = await fetch(url);
                    if (!response.ok) throw new Error(`Gambar kartu gagal dimuat (${response.status}).`);
                    const blob = await response.blob();
                    return new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                })().catch(err => {
                    staticImageCache.delete(url);
                    throw err;
                });
                staticImageCache.set(url, pending);
            }
            // Fail rather than silently download a card with missing photos/signatures.
            img.src = await staticImageCache.get(url);
        }
        await img.decode();
    }));
}

/** Capture the matching live preview, or render the same screen template offscreen. */
export async function rasterizeKtsFace(studentId, side, createFace, ensureAssets, options = {}) {
    const exporter = await getExporter();
    const scope = typeof options.previewContainer === 'string'
        ? document.getElementById(options.previewContainer) : (options.previewContainer || document);
    const previews = Array.from(scope?.querySelectorAll('.kts-face[data-kts-side]') || [])
        .filter(face => face.dataset.ktsStudent === studentId
            && !face.closest('[data-kts-export-stage]') && face.getClientRects().length > 0);
    const source = previews.find(face => face.dataset.ktsSide === side);
    // Wait before copying the wrapper: fonts/images and ResizeObserver can still
    // settle the preview's responsive scale during the initial render.
    if (source || previews[0]) await ensureAssets(source || previews[0]);
    const previewParent = source?.parentElement || previews[0]?.parentElement;
    const stage = previewParent ? previewParent.cloneNode(false) : document.createElement('div');
    stage.dataset.ktsExportStage = '';
    stage.setAttribute('aria-hidden', 'true');
    Object.assign(stage.style, {
        position: 'fixed', left: '-10000px', top: '0', pointerEvents: 'none',
        width: '440px', maxWidth: 'none', margin: '0', transform: 'none', transition: 'none'
    });
    // A modal can mount only one side. Keep the other side in the same CSS
    // context (theme, custom properties and responsive scale) as its preview.
    (previewParent?.parentElement || document.body).appendChild(stage);
    try {
        let face;
        let width;
        let height;
        if (source) {
            const computed = getComputedStyle(source);
            width = parseFloat(computed.width);
            height = parseFloat(computed.height);
            face = source.cloneNode(true);
            // Keep real CSS layout. Freezing computed widths here and again in
            // the exporter would apply flex sizing twice and change line breaks.
            copyRenderedMedia(source, face);
            stage.appendChild(face);
        } else {
            face = createFace(stage);
            await ensureAssets(face);
            const computed = getComputedStyle(face);
            width = parseFloat(computed.width);
            height = parseFloat(computed.height);
        }
        if (!(width > 0 && height > 0)) throw new Error('Ukuran preview kartu belum siap.');
        // Remove only screen placement/flip; preserve the card's computed design.
        for (const [property, value] of Object.entries({
            position: 'relative', top: '0', left: '0', margin: '0', transform: 'none',
            opacity: '1', visibility: 'visible', transition: 'none', animation: 'none',
            'backface-visibility': 'visible', '-webkit-backface-visibility': 'visible',
            'transform-style': 'flat'
        })) face.style.setProperty(property, value, 'important');
        await embedImages(face);
        const fontEmbedCSS = await getCardFontCss(face);
        const outputWidth = options.width || 1011;
        const outputHeight = options.height || Math.round(outputWidth * height / width);
        return await exporter.toCanvas(face, {
            width, height, canvasWidth: outputWidth, canvasHeight: outputHeight,
            pixelRatio: 1, fontEmbedCSS,
            // Width/height styles on the clone must retain the CSS border-box size.
            skipAutoScale: true
        });
    } finally {
        stage.remove();
    }
}
