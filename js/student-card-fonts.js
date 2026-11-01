// Embed the fonts used by the preview without inserting remote CSS into the page.
// html-to-image's cross-origin CSS importer can discard already-inlined fonts.
const resources = new Map();
const fontCssCache = new Map();

export function clearCardFontCssCache() {
    resources.clear();
    fontCssCache.clear();
}

function fetchResource(url, asDataUrl = false) {
    const key = `${asDataUrl}:${url}`;
    if (!resources.has(key)) {
        const pending = fetch(url).then(async response => {
            if (!response.ok) throw new Error(`Font kartu gagal dimuat (${response.status}).`);
            if (!asDataUrl) return response.text();
            const blob = await response.blob();
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }).catch(error => { resources.delete(key); throw error; });
        resources.set(key, pending);
    }
    return resources.get(key);
}

export async function getCardFontCss(face) {
    const families = new Set();
    const normalize = value => value.trim().replace(/["']/g, '').toLowerCase();
    for (const node of [face, ...face.querySelectorAll('*')]) {
        for (const pseudo of [null, '::before', '::after']) {
            const style = getComputedStyle(node, pseudo);
            style.fontFamily.split(',').forEach(family => families.add(normalize(family)));
        }
    }

    const cacheKey = Array.from(families).sort().join('|');
    if (fontCssCache.has(cacheKey)) {
        return fontCssCache.get(cacheKey);
    }

    const pendingFontCss = (async () => {
        const fonts = [];
        async function readSheet(sheet) {
            if (!sheet) return;
            let rules;
            try { rules = Array.from(sheet.cssRules); }
            catch {
                if (!sheet.href) return;
                const text = await fetchResource(sheet.href);
                const detached = new CSSStyleSheet();
                // Parse only font declarations. Never modify the live stylesheet/cascade.
                detached.replaceSync((text.match(/@font-face\s*\{[^}]*\}/gi) || []).join('\n'));
                rules = Array.from(detached.cssRules);
            }

            const importPromises = [];
            const fontRuleCandidates = [];

            for (const rule of rules) {
                if (rule.type === CSSRule.IMPORT_RULE) {
                    importPromises.push(readSheet(rule.styleSheet));
                } else if (rule.type === CSSRule.FONT_FACE_RULE && families.has(normalize(rule.style.fontFamily))) {
                    const src = rule.style.getPropertyValue('src');
                    const candidates = Array.from(src.matchAll(/url\(\s*['"]?([^'"\)]+)['"]?\s*\)\s*(?:format\(['"]?([^'"\)]+)['"]?\))?/gi));
                    const selected = candidates.find(match => match[2] === 'woff2') || candidates[0];
                    if (selected) {
                        fontRuleCandidates.push({ rule, selected });
                    }
                }
            }

            if (importPromises.length > 0) {
                await Promise.all(importPromises);
            }

            if (fontRuleCandidates.length > 0) {
                const extractedFonts = await Promise.all(fontRuleCandidates.map(async ({ rule, selected }) => {
                    const url = new URL(selected[1].trim(), sheet.href || document.baseURI).href;
                    const data = url.startsWith('data:') ? url : await fetchResource(url, true);
                    const copy = new CSSStyleSheet();
                    copy.replaceSync(rule.cssText);
                    copy.cssRules[0].style.setProperty('src', `url("${data}")${selected[2] ? ` format("${selected[2]}")` : ''}`);
                    return copy.cssRules[0].cssText;
                }));
                fonts.push(...extractedFonts);
            }
        }

        const sheets = Array.from(document.styleSheets).filter(sheet => !sheet.disabled);
        await Promise.all(sheets.map(sheet => readSheet(sheet)));

        return [...new Set(fonts)].join('\n');
    })().catch(err => {
        fontCssCache.delete(cacheKey);
        throw err;
    });

    fontCssCache.set(cacheKey, pendingFontCss);
    return pendingFontCss;
}
