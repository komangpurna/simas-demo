/**
 * KONFIGURASI IDENTITAS SEKOLAH
 * ==============================
 * Identitas tampilan sekolah. Untuk instalasi sekolah lain beserta layanan backend,
 * gunakan npm run school:prepare (lihat docs/adopsi-sekolah.md).
 * Template halaman mengacu ke key konfigurasi dengan format {{namaKey}}.
 */
export const SCHOOL_CONFIG = Object.freeze({
    // Aplikasi
    appName: 'SIMAS',
    appThemeColor: '#0f172a',

    // Sekolah
    schoolName: "SMA Negeri Nusantara",
    schoolShortName: "SMANTARA",
    schoolNPSN: "99887766",
    schoolLevel: 'SMA',
    schoolAddress: "Jl. Nusantara No. 1, Denpasar",
    schoolAddressFull: "Jl. Nusantara No. 1, Denpasar",
    schoolAddressShort: "Jl. Nusantara No. 1, Denpasar",
    schoolStreetAddress: "Jl. Nusantara No. 1, Denpasar",
    schoolCity: "Denpasar",
    schoolProvince: "Bali",
    schoolPostalCode: "80234",
    schoolPhone: "-",
    schoolWebsite: "https://simas-demo-5ead3.web.app",
    schoolAccreditation: "A (Unggul)",

    // Budaya sekolah
    schoolVisiAcronym: "CERDAS",
    schoolVisiDesc: "Cendekia • Empati • Religius • Disiplin • Adaptif • Santun",

    // Kontak dan domain
    emailDomain: "smanusantara.sch.id",
    telegramBotUser: "simas_demo_bot",
    primaryDomain: "simas-demo-5ead3.web.app",
    developerWebsite: 'https://komangpurna.web.app',
    // Domain mirror yang otomatis diarahkan ke primaryDomain (PWA Production).
    // Domain staging/testing (sman1abang.web.app) TIDAK dialihkan agar branch testing dapat diuji secara live.
    canonicalAliasDomains: [],
    studentDocsAppsScriptUrl: "https://script.google.com/macros/s/AKfycbxrCFTVk6eFmNGa3AK-_kb4qFb1AxU7ztEsdE3ijoejF6yRYbnqF0yz-yDpzzpxxjegsg/exec",
    ekinerjaAppsScriptUrl: "https://script.google.com/macros/s/AKfycbwGwYmeLUiJUAI-FHK3cDUAddFLtpmnIKRfKX5PyeJRpktj6KlqnAqeKd6ImW3k-x0m/exec",

    // Aset. Path selalu dihitung dari root aplikasi.
    logoPath: 'assets/logo-sekolah.png',
    logoPaddedPath: 'assets/logo-sekolah-padded.png',
    logoPadded192Path: 'assets/logo-sekolah-padded-192.png',
    logoVideoPath: 'assets/logoonly.webm',
    kopPath: 'assets/kop.png',
    kopTransparentPath: 'assets/kop-transparan.png',
    ttePath: 'assets/tte.png',
    headmasterSignaturePath: 'assets/ttd-kepsek.png',
    schoolStampPath: 'assets/cap-sekolah.png',

    // Pejabat dan dokumen resmi
    headmasterName: "Dr. I Wayan Sudarsana, M.Pd.",
    headmasterRank: "-",
    headmasterNIP: "197501012000031001",
    defaultSuratKeteranganNo: "B.10.400.7.22.1/001/SMAN-NUSANTARA/2026",

    // Pengurus Komite & Pejabat Keuangan Sekolah (SSOT)
    bendaharaKomiteName: "-",
    bendaharaKomiteNIP: "-",
    ketuaKomiteName: "-",
    ketuaKomiteNIP: "-",

    // Pejabat Lainnya (Default Sesuai Konfigurasi Sekolah)
    wakabidSarprasName: "-",
    wakabidSarprasNIP: "-",
    audit1Name: "-",
    audit1NIP: "-",
    audit2Name: "-",
    audit2NIP: "-",
    bendaharaSekolahName: "-",
    bendaharaSekolahNIP: "-",

    // Nilai turunan otomatis agar nama yang sama tidak ditulis dua kali (SSOT).
    get appBrand() { return `${this.appName} - ${this.schoolVisiAcronym}`; },
    get appShortBrand() { return `${this.appName} - ${this.schoolVisiAcronym}`; },
    get appTagline() { return `Sistem Informasi Manajemen ${this.schoolShortName} ${this.schoolVisiAcronym}`; },
    get appDescription() { return `${this.appTagline} - ${this.schoolName}`; },
    get developerName() { return `${this.schoolShortName} IT Dev Team`; },
    get schoolNameUpper() { return this.schoolName.toLocaleUpperCase('id-ID'); },
    get schoolVisiTitle() { return this.schoolVisiAcronym.charAt(0) + this.schoolVisiAcronym.slice(1).toLocaleLowerCase('id-ID'); },
    get schoolMotto() { return `"${this.schoolVisiAcronym} - Berwawasan Lingkungan"`; },
    get libraryName() { return `Perpustakaan Widya ${this.schoolVisiTitle}`; },
    get faviconPath() { return this.logoPath; },
    get headmasterTitle() { return `Kepala ${this.schoolName}`; }
});

const ROOT_URL = new URL('../', import.meta.url);
const ASSET_KEYS = ['logoPath', 'logoVideoPath', 'kopPath', 'kopTransparentPath', 'ttePath', 'faviconPath', 'headmasterSignaturePath', 'schoolStampPath'];

export function isClonedSchool() {
    return SCHOOL_CONFIG.schoolName !== 'SMA Negeri 1 Abang' || SCHOOL_CONFIG.schoolShortName !== 'SMAGESA';
}

export function getSchoolIdentity(key, fallback = '') {
    return (SCHOOL_CONFIG && Object.prototype.hasOwnProperty.call(SCHOOL_CONFIG, key))
        ? SCHOOL_CONFIG[key]
        : fallback;
}

export function schoolAssetUrl(path) {
    return new URL(String(path || '').replace(/^\.\//, ''), ROOT_URL).href;
}

export function replaceSchoolIdentityText(value) {
    if (value === null || value === undefined) return '';
    let result = String(value).replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g, (token, key) => (
        Object.prototype.hasOwnProperty.call(SCHOOL_CONFIG, key)
            ? String(SCHOOL_CONFIG[key])
            : token
    ));

    // Smart Auto-Replacer untuk mode cloning sekolah lain:
    // Hanya aktif jika nama atau singkatan sekolah di SCHOOL_CONFIG telah diubah dari nilai default.
    // Jika masih di SMA Negeri 1 Abang (default), tahap ini dilewati sepenuhnya (zero overhead & 0 efek samping).
    if (isClonedSchool()) {
        if (SCHOOL_CONFIG.schoolName && SCHOOL_CONFIG.schoolName !== 'SMA Negeri 1 Abang' && !result.includes(SCHOOL_CONFIG.schoolName)) {
            result = result
                .replace(/SMA\s+Negeri\s+1\s+Abang/gi, () => SCHOOL_CONFIG.schoolName)
                .replace(/SMAN\s+1\s+Abang/gi, () => SCHOOL_CONFIG.schoolName);
        }
        if (SCHOOL_CONFIG.schoolShortName && SCHOOL_CONFIG.schoolShortName !== 'SMAGESA' && !result.includes(SCHOOL_CONFIG.schoolShortName)) {
            result = result.replace(/\bSMAGESA\b/g, () => SCHOOL_CONFIG.schoolShortName);
        }
        if (SCHOOL_CONFIG.schoolVisiAcronym && SCHOOL_CONFIG.schoolVisiAcronym !== 'SHAKTI' && !result.includes(SCHOOL_CONFIG.schoolVisiAcronym)) {
            result = result.replace(/\bSHAKTI\b/g, () => SCHOOL_CONFIG.schoolVisiAcronym);
        }
        if (SCHOOL_CONFIG.telegramBotUser && SCHOOL_CONFIG.telegramBotUser !== 'smagesa_bot' && !result.includes(SCHOOL_CONFIG.telegramBotUser)) {
            result = result.replace(/\bsmagesa_bot\b/g, () => SCHOOL_CONFIG.telegramBotUser);
        }
        if (SCHOOL_CONFIG.primaryDomain && SCHOOL_CONFIG.primaryDomain !== 'smagesa.web.app' && !result.includes(SCHOOL_CONFIG.primaryDomain)) {
            result = result.replace(/\bsmagesa\.web\.app\b/g, () => SCHOOL_CONFIG.primaryDomain);
        }
        // Tautan/alamat pada HTML lama tetap mengikuti profil salinan tanpa mengubah layout.
        const legacyIdentity = [
            ['https://smanegeri1abang.sch.id', SCHOOL_CONFIG.schoolWebsite],
            ['smanegeri1abang.sch.id', SCHOOL_CONFIG.emailDomain],
            ['Jl. Ida Ketut Jelantik, Desa Tista, Kecamatan Abang, Karangasem, Bali', SCHOOL_CONFIG.schoolAddress],
            ['Jl. Ida Ketut Jelantik, Desa Tista, Kecamatan Abang', SCHOOL_CONFIG.schoolAddressShort]
        ];
        for (const [legacy, configured] of legacyIdentity) {
            if (configured && configured !== legacy && !result.includes(configured)) result = result.split(legacy).join(configured);
        }
        if (SCHOOL_CONFIG.appName && SCHOOL_CONFIG.appName !== 'SIMAS' && !result.includes(SCHOOL_CONFIG.appName)) {
            result = result.replace(/\bSIMAS\b/g, () => SCHOOL_CONFIG.appName);
        }
    }

    return result;
}

function updateElement(element) {
    if (!(element instanceof Element)) return;

    const configKey = element.dataset.schoolConfig;
    if (configKey && Object.prototype.hasOwnProperty.call(SCHOOL_CONFIG, configKey)) {
        const configuredText = String(SCHOOL_CONFIG[configKey]);
        if (element.textContent !== configuredText) element.textContent = configuredText;
    }

    const assetConfigKey = element.dataset.schoolAsset;
    if (assetConfigKey && ASSET_KEYS.includes(assetConfigKey)) {
        element.setAttribute('src', schoolAssetUrl(SCHOOL_CONFIG[assetConfigKey]));
    }

    for (const attribute of ['title', 'placeholder', 'alt', 'aria-label', 'content', 'href', 'value']) {
        if (element.hasAttribute(attribute)) {
            const current = element.getAttribute(attribute);
            const updated = replaceSchoolIdentityText(current);
            if (updated !== current) element.setAttribute(attribute, updated);
        }
    }

    const source = element.getAttribute('src') || '';
    const normalizedSource = source.replace(/^(?:\.\.\/|\.\/)+/, '');
    const legacyAssets = {
        'assets/logo-sekolah.png': 'logoPath',
        'assets/logo-sekolah-padded.png': 'logoPaddedPath',
        'assets/logo-sekolah-padded-192.png': 'logoPadded192Path',
        'assets/logoonly.webm': 'logoVideoPath',
        'assets/kop.png': 'kopPath',
        'assets/kop-transparan.png': 'kopTransparentPath',
        'assets/tte.png': 'ttePath',
        'assets/ttd-kepsek.png': 'headmasterSignaturePath',
        'assets/cap-sekolah.png': 'schoolStampPath'
    };
    const assetKey = legacyAssets[normalizedSource];
    if (assetKey && SCHOOL_CONFIG[assetKey]) {
        element.setAttribute('src', schoolAssetUrl(SCHOOL_CONFIG[assetKey]));
    }
}

/** Terapkan konfigurasi ke template HTML dan konten yang dibuat secara dinamis. */
export function applySchoolIdentity(root = document) {
    if (typeof document === 'undefined' || !root) return;

    if (root.nodeType === Node.TEXT_NODE) {
        const updated = replaceSchoolIdentityText(root.nodeValue);
        if (updated !== root.nodeValue) root.nodeValue = updated;
        return;
    }

    if (root instanceof Element) updateElement(root);

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
        if (node.parentElement?.closest('script, style')) continue;
        const updated = replaceSchoolIdentityText(node.nodeValue);
        if (updated !== node.nodeValue) node.nodeValue = updated;
    }

    if (root.querySelectorAll) root.querySelectorAll('*').forEach(updateElement);
}

function applyDocumentMetadata() {
    if (typeof document === 'undefined') return;

    if (document.title) {
        let updatedTitle = replaceSchoolIdentityText(document.title);
        if (updatedTitle !== document.title) {
            document.title = updatedTitle;
        }
    }

    document.documentElement.style.setProperty('--school-theme-color', SCHOOL_CONFIG.appThemeColor);

    let theme = document.querySelector('meta[name="theme-color"]');
    if (!theme) {
        theme = document.createElement('meta');
        theme.name = 'theme-color';
        document.head?.appendChild(theme);
    }
    if (theme) theme.content = SCHOOL_CONFIG.appThemeColor;

    const description = document.querySelector('meta[name="description"]');
    if (description) description.content = SCHOOL_CONFIG.appDescription;

    let appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (!appleTitle) {
        appleTitle = document.createElement('meta');
        appleTitle.name = 'apple-mobile-web-app-title';
        document.head?.appendChild(appleTitle);
    }
    if (appleTitle) appleTitle.content = SCHOOL_CONFIG.appShortBrand;

    const targetFaviconUrl = schoolAssetUrl(SCHOOL_CONFIG.faviconPath);
    let favicon = document.querySelector('link[rel~="icon"]');
    if (!favicon) {
        favicon = document.createElement('link');
        favicon.rel = 'icon';
        favicon.href = targetFaviconUrl;
        document.head?.appendChild(favicon);
    } else {
        const currentHref = favicon.getAttribute('href') || '';
        if (currentHref !== targetFaviconUrl && favicon.href !== targetFaviconUrl && currentHref !== SCHOOL_CONFIG.faviconPath) {
            favicon.href = targetFaviconUrl;
        }
    }

    const targetAppleTouchIconUrl = schoolAssetUrl(SCHOOL_CONFIG.logoPaddedPath || SCHOOL_CONFIG.logoPath);
    let appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
    if (!appleIcon) {
        appleIcon = document.createElement('link');
        appleIcon.rel = 'apple-touch-icon';
        appleIcon.href = targetAppleTouchIconUrl;
        document.head?.appendChild(appleIcon);
    } else {
        const currentAppleHref = appleIcon.getAttribute('href') || '';
        if (currentAppleHref !== targetAppleTouchIconUrl && appleIcon.href !== targetAppleTouchIconUrl) {
            appleIcon.href = targetAppleTouchIconUrl;
        }
    }

    let manifestLink = document.querySelector('link[rel="manifest"]');
    if (!manifestLink) {
        manifestLink = document.createElement('link');
        manifestLink.rel = 'manifest';
        document.head?.appendChild(manifestLink);
    }
    if (manifestLink && !manifestLink.dataset.schoolConfigApplied) {
        const manifestBlob = new Blob([JSON.stringify(createSchoolManifest())], { type: 'application/manifest+json' });
        manifestLink.href = URL.createObjectURL(manifestBlob);
        manifestLink.dataset.schoolConfigApplied = 'true';
    }
}

export function createSchoolManifest() {
    const icon = schoolAssetUrl(SCHOOL_CONFIG.logoPath);
    const icon192 = schoolAssetUrl(SCHOOL_CONFIG.logoPadded192Path || 'assets/logo-sekolah-padded-192.png');
    const icon512 = schoolAssetUrl(SCHOOL_CONFIG.logoPaddedPath || 'assets/logo-sekolah-padded.png');
    const appRoot = ROOT_URL.href;
    const appUrl = path => new URL(path, ROOT_URL).href;
    return {
        name: SCHOOL_CONFIG.appBrand,
        short_name: SCHOOL_CONFIG.appShortBrand,
        description: SCHOOL_CONFIG.appDescription,
        id: appUrl('index.html'),
        start_url: appUrl('index.html'),
        scope: appRoot,
        display: 'standalone',
        background_color: SCHOOL_CONFIG.appThemeColor,
        theme_color: SCHOOL_CONFIG.appThemeColor,
        orientation: 'any',
        icons: [
            { src: icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: icon512, sizes: '512x512', type: 'image/png', purpose: 'any' }
        ],
        shortcuts: [
            { name: 'E-Kinerja', short_name: 'E-Kinerja', url: appUrl('e-kinerja.html'), icons: [{ src: icon192, sizes: '192x192', type: 'image/png' }, { src: icon512, sizes: '512x512', type: 'image/png' }] },
            { name: 'E-Kinerja Tendik', short_name: 'E-Kinerja Tendik', url: appUrl('e-kinerja-tendik.html'), icons: [{ src: icon192, sizes: '192x192', type: 'image/png' }, { src: icon512, sizes: '512x512', type: 'image/png' }] },
            { name: 'Monitoring KBM', short_name: 'Monitoring KBM', url: appUrl('monitoring-kbm.html'), icons: [{ src: icon192, sizes: '192x192', type: 'image/png' }, { src: icon512, sizes: '512x512', type: 'image/png' }] },
            { name: 'Lihat Agenda', short_name: 'Lihat Agenda', url: appUrl('agenda.html'), icons: [{ src: icon192, sizes: '192x192', type: 'image/png' }, { src: icon512, sizes: '512x512', type: 'image/png' }] },
            { name: 'Lapor!mas', short_name: 'Lapor!mas', url: appUrl('index.html?action=lapor'), icons: [{ src: icon192, sizes: '192x192', type: 'image/png' }, { src: icon512, sizes: '512x512', type: 'image/png' }] }
        ],
        related_applications: [
            { platform: 'webapp', url: appUrl('manifest.json') }
        ]
    };
}

function initializeSchoolIdentity() {
    window.SCHOOL_CONFIG = SCHOOL_CONFIG;
    window.schoolAssetUrl = schoolAssetUrl;
    window.applySchoolIdentity = applySchoolIdentity;
    window.isClonedSchool = isClonedSchool;
    window.getSchoolIdentity = getSchoolIdentity;
    window.replaceSchoolIdentityText = replaceSchoolIdentityText;

    if (document.head) {
        applyDocumentMetadata();
    }

    const run = () => {
        applySchoolIdentity(document);
        applyDocumentMetadata();

        if (document.body) {
            const observer = new MutationObserver(mutations => {
                for (const mutation of mutations) {
                    mutation.addedNodes.forEach(applySchoolIdentity);
                    if (mutation.type === 'characterData') applySchoolIdentity(mutation.target);
                }
            });
            observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
    else run();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') initializeSchoolIdentity();
