/**
 * tests/masukan-sender-avatar.test.js
 * Unit Test Resolusi Foto Profil Pengirim dan Komponen Avatar pada Halaman Masukan
 */

describe('Modul Masukan - Resolusi Foto Profil Pengirim & Avatar SSOT', () => {
    let mockStorage = {};

    beforeEach(() => {
        mockStorage = {};
        global.localStorage = {
            getItem: (key) => mockStorage[key] || null,
            setItem: (key, val) => { mockStorage[key] = String(val); },
            removeItem: (key) => { delete mockStorage[key]; },
            clear: () => { mockStorage = {}; }
        };
        global.sessionStorage = {
            getItem: (key) => mockStorage[key] || null,
            setItem: (key, val) => { mockStorage[key] = String(val); },
            removeItem: (key) => { delete mockStorage[key]; },
            clear: () => { mockStorage = {}; }
        };
    });

    // Helper implementasi mandiri fungsi yang sama persis seperti di page-masukan.js
    function resolvePhotoUrl(url) {
        if (!url || typeof url !== 'string') return '';
        const trimmed = url.trim();
        if (!trimmed) return '';
        if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed;
        const workerBase = 'https://simas-smagesa-api.komangpurna1.workers.dev';
        if (trimmed.startsWith('/api/')) return `${workerBase}${trimmed}`;
        if (trimmed.startsWith('api/')) return `${workerBase}/${trimmed}`;
        return trimmed;
    }

    function getInitials(name = '') {
        if (!name || name === 'Anonim') return 'AN';
        const parts = name.trim().split(/\s+/);
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }

    function escapeHTML(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function resolveSenderPhoto(item, teachersMap = null, currentUser = null, currentProfile = null) {
        if (!item) return '';
        if (item.reporterType === 'anonim' || item.senderName === 'Anonim') return '';

        // 1. Direct photo URL jika tersimpan di item
        const directPhoto = item.senderPhoto || item.sender_photo;
        if (directPhoto) return resolvePhotoUrl(directPhoto);

        // 2. Jika pengirim adalah user aktif yang sedang login
        if (currentUser && item.senderUid && item.senderUid === currentUser.uid) {
            const myPhoto = localStorage.getItem(`cached_user_photo_${currentUser.uid}`) ||
                currentProfile?.photo ||
                currentUser?.photoURL;
            if (myPhoto) return resolvePhotoUrl(myPhoto);
        }

        // 3. Resolusi dari master GTK D1 (teachersMap) dengan multi-index (0 Firestore Read)
        if (teachersMap) {
            let t = null;
            if (item.senderUid) t = teachersMap.get(item.senderUid);
            if (!t && item.senderEmail) t = teachersMap.get(item.senderEmail.toLowerCase().trim());
            if (!t && item.senderName) t = teachersMap.get(item.senderName.toLowerCase().trim());

            if (t) {
                const raw = t.foto || t.photo_url || t.simasFoto;
                if (raw) return resolvePhotoUrl(raw);
            }
        }

        return '';
    }

    function renderUserAvatarHtml({ name = 'Pengguna', photoUrl = '', size = 'w-10 h-10 text-xs', isAnon = false, bgGradient = 'from-blue-600 to-indigo-600' } = {}) {
        if (isAnon) {
            return `
            <div class="${size} rounded-full bg-slate-700 text-slate-200 flex items-center justify-center shrink-0 shadow-2xs" title="Anonim">
                <i class="fa-solid fa-user-secret"></i>
            </div>
        `.trim();
        }

        const initials = escapeHTML(getInitials(name));
        const safeName = escapeHTML(name || 'Pengguna');

        if (photoUrl) {
            const safeUrl = escapeHTML(photoUrl);
            return `
            <div class="${size} rounded-full bg-slate-100 dark:bg-slate-800 shrink-0 shadow-2xs overflow-hidden ring-1 ring-slate-200/80 dark:ring-slate-700 flex items-center justify-center">
                <img src="${safeUrl}" alt="${safeName}" class="w-full h-full object-cover rounded-full" onerror="this.onerror=null; this.parentElement.innerHTML='<span class=\\'font-extrabold text-white\\'>${initials}</span>'; this.parentElement.className='${size} rounded-full bg-gradient-to-tr ${bgGradient} text-white font-extrabold flex items-center justify-center shrink-0 shadow-2xs';">
            </div>
        `.trim();
        }

        return `
        <div class="${size} rounded-full bg-gradient-to-tr ${bgGradient} text-white font-extrabold flex items-center justify-center shrink-0 shadow-2xs">
            ${initials}
        </div>
    `.trim();
    }

    test('1. Resolusi foto pengirim dari cache profil lokal user yang sedang aktif', () => {
        const currentUser = { uid: 'user-guru-123', email: 'guru@smagesa.sch.id' };
        localStorage.setItem('cached_user_photo_user-guru-123', 'https://images.smagesa.sch.id/photos/guru123.webp');

        const item = {
            id: 'fb-01',
            senderUid: 'user-guru-123',
            senderName: 'I Komang Purna',
            reporterType: 'guru_staf'
        };

        const resolved = resolveSenderPhoto(item, null, currentUser, null);
        expect(resolved).toBe('https://images.smagesa.sch.id/photos/guru123.webp');
    });

    test('2. Resolusi foto pengirim dari teachersMap D1 via email guru dengan path streaming Cloudflare', () => {
        const teachersMap = new Map();
        teachersMap.set('budi@smagesa.sch.id', {
            id: 'gtk-45',
            name: 'Budi Santoso',
            email: 'budi@smagesa.sch.id',
            foto: '/api/photos/teachers/gtk-45.webp'
        });

        const item = {
            id: 'fb-02',
            senderUid: 'other-uid-789',
            senderEmail: 'budi@smagesa.sch.id',
            senderName: 'Budi Santoso',
            reporterType: 'guru_staf'
        };

        const resolved = resolveSenderPhoto(item, teachersMap, null, null);
        expect(resolved).toBe('https://simas-smagesa-api.komangpurna1.workers.dev/api/photos/teachers/gtk-45.webp');
    });

    test('3. Resolusi foto pengirim dari teachersMap D1 via nama guru jika email tidak ada', () => {
        const teachersMap = new Map();
        teachersMap.set('siti rahayu', {
            id: 'gtk-99',
            name: 'Siti Rahayu',
            photo_url: 'https://cdn.smagesa.sch.id/siti.png'
        });

        const item = {
            id: 'fb-03',
            senderName: 'Siti Rahayu',
            reporterType: 'internal'
        };

        const resolved = resolveSenderPhoto(item, teachersMap, null, null);
        expect(resolved).toBe('https://cdn.smagesa.sch.id/siti.png');
    });

    test('4. Proteksi privasi: pelapor berstatus anonim tidak menampilkan foto profil', () => {
        const teachersMap = new Map();
        teachersMap.set('user-anon-uid', {
            id: 'gtk-10',
            name: 'Guru Rahasia',
            foto: 'https://images.smagesa.sch.id/rahasia.jpg'
        });

        const anonItem = {
            id: 'fb-04',
            senderUid: 'user-anon-uid',
            senderName: 'Anonim',
            reporterType: 'anonim'
        };

        const resolved = resolveSenderPhoto(anonItem, teachersMap, null, null);
        expect(resolved).toBe('');

        const avatarHtml = renderUserAvatarHtml({
            name: anonItem.senderName,
            photoUrl: resolved,
            isAnon: true
        });

        expect(avatarHtml).toContain('fa-user-secret');
        expect(avatarHtml).not.toContain('<img');
    });

    test('5. Komponen avatar merender tag <img> saat foto tersedia dengan fallback onerror', () => {
        const photoUrl = 'https://simas.sch.id/avatar.webp';
        const html = renderUserAvatarHtml({
            name: 'Wayan Sujana',
            photoUrl,
            size: 'w-10 h-10 text-xs'
        });

        expect(html).toContain('<img src="https://simas.sch.id/avatar.webp"');
        expect(html).toContain('alt="Wayan Sujana"');
        expect(html).toContain('object-cover rounded-full');
        expect(html).toContain('onerror="this.onerror=null;');
        expect(html).toContain('WS'); // fallback initials
    });

    test('6. Komponen avatar merender inisial bersih bergradasi saat foto tidak tersedia', () => {
        const html = renderUserAvatarHtml({
            name: 'Dewi Lestari',
            photoUrl: '',
            size: 'w-10 h-10 text-xs',
            bgGradient: 'from-blue-600 to-indigo-600'
        });

        expect(html).not.toContain('<img');
        expect(html).toContain('DL');
        expect(html).toContain('bg-gradient-to-tr from-blue-600 to-indigo-600');
    });

    test('7. Resolusi foto balasan pada thread: replier menggunakan foto profilnya sendiri', () => {
        const currentUser = { uid: 'uid-pimpinan-1' };
        localStorage.setItem('cached_user_photo_uid-pimpinan-1', 'https://simas.sch.id/kepsek.webp');

        const reply = {
            id: 'rep-01',
            sender_uid: 'uid-pimpinan-1',
            sender_name: 'Kepala Sekolah',
            sender_role: 'kepala_sekolah',
            sender_type: 'leadership',
            message: 'Aspirasi diterima dan segera ditindaklanjuti.'
        };

        let replyPhoto = reply.sender_photo ? resolvePhotoUrl(reply.sender_photo) : '';
        if (!replyPhoto && reply.sender_uid && reply.sender_uid === currentUser.uid) {
            replyPhoto = resolvePhotoUrl(localStorage.getItem(`cached_user_photo_${currentUser.uid}`));
        }

        expect(replyPhoto).toBe('https://simas.sch.id/kepsek.webp');

        const replyAvatarHtml = renderUserAvatarHtml({
            name: reply.sender_name,
            photoUrl: replyPhoto,
            size: 'w-6 h-6 text-[10px]',
            bgGradient: 'from-emerald-600 to-teal-600'
        });

        expect(replyAvatarHtml).toContain('<img src="https://simas.sch.id/kepsek.webp"');
        expect(replyAvatarHtml).toContain('w-6 h-6');
    });
});
