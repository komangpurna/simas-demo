/** Route teacher links without attempting frames forbidden by the Hosting policy. */
export function resolveLmsResourceLink(value, resourceType, appOrigin = globalThis.location?.origin) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        let input = value.trim();
        if (input.startsWith('//')) input = `https:${input}`;
        else if (!/^[a-z][a-z0-9+.-]*:/i.test(input)) input = `https://${input}`;
        const source = new URL(input);
        if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password) return null;
        const host = source.hostname.toLowerCase();
        let embedUrl = '';
        // Keep this list aligned with frame-src in firebase.json. A site's own
        // X-Frame-Options/frame-ancestors may still require the external button.
        if (source.protocol === 'https:') {
            if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtube-nocookie.com'].includes(host)) {
                const parts = source.pathname.split('/').filter(Boolean);
                const video = host === 'youtu.be' ? parts[0] :
                    ['embed', 'shorts', 'live'].includes(parts[0]) ? parts[1] : source.searchParams.get('v');
                if (/^[\w-]{6,64}$/.test(video || '')) embedUrl = `https://www.youtube.com/embed/${encodeURIComponent(video)}`;
            } else if (['drive.google.com', 'docs.google.com'].includes(host)) {
                const match = source.pathname.match(/\/d\/([\w-]+)(?:\/|$)/);
                const driveId = host === 'drive.google.com' ? source.searchParams.get('id') : '';
                const id = match?.[1] === 'e' ? '' : match?.[1] || driveId;
                if (id && /^[\w-]+$/.test(id)) {
                    const prefix = host === 'drive.google.com' ? '/file' : source.pathname.split('/d/')[0];
                    embedUrl = `https://${host}${prefix}/d/${encodeURIComponent(id)}/preview`;
                } else embedUrl = source.href;
            } else if (["simas-demo-5ead3.web.app", 'sman1abang.web.app'].includes(host)) embedUrl = source.href;
        }
        if (source.origin === appOrigin) embedUrl = source.href;
        return { url: source.href, embedUrl, hostname: host, isCanva: host === 'canva.site' || host.endsWith('.canva.site') };
    } catch (_) { return null; }
}
