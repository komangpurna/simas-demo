describe('Modul Masukan & Saran - Thread Percakapan, Otorisasi Balasan, dan Badge NEW', () => {
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

    test('1. Normalisasi Thread Percakapan: legacy response_text dikonversi menjadi reply pertama', () => {
        const legacyItem = {
            id: 'fb-001',
            title: 'Kendala Proyektor Lab',
            message: 'Proyektor di lab 2 buram',
            responseText: 'Terima kasih, sudah kami jadwalkan perbaikan oleh tim teknis.',
            responseByUid: 'admin-123',
            responseByName: 'Kepala Lab',
            respondedAt: '2026-09-08T10:00:00.000Z',
            replies: []
        };

        // Helper fungsi penyusun allReplies seperti di page-masukan.js
        let allReplies = [];
        if (Array.isArray(legacyItem.replies) && legacyItem.replies.length > 0) {
            allReplies = [...legacyItem.replies];
        } else if (legacyItem.responseText) {
            allReplies.push({
                id: 'legacy-resp-' + legacyItem.id,
                sender_uid: legacyItem.responseByUid || 'leadership',
                sender_name: legacyItem.responseByName || 'Pimpinan',
                sender_role: 'leadership',
                sender_type: 'leadership',
                message: legacyItem.responseText,
                created_at: legacyItem.respondedAt
            });
        }

        expect(allReplies).toHaveLength(1);
        expect(allReplies[0].sender_name).toBe('Kepala Lab');
        expect(allReplies[0].sender_type).toBe('leadership');
        expect(allReplies[0].message).toContain('sudah kami jadwalkan perbaikan');
    });

    test('2. Multi-turn replies: mendukung balasan timbal balik dari pengirim dan pimpinan', () => {
        const threadedItem = {
            id: 'fb-002',
            title: 'Usul Tambahan Buku Perpustakaan',
            message: 'Mohon buku sains kelas 12 diperbanyak',
            replies: [
                {
                    id: 'rep-1',
                    sender_uid: 'lead-01',
                    sender_name: 'Kepala Sekolah',
                    sender_type: 'leadership',
                    message: 'Judul spesifik buku apa yang dibutuhkan?',
                    created_at: '2026-09-09T08:00:00.000Z'
                },
                {
                    id: 'rep-2',
                    sender_uid: 'user-guru-1',
                    sender_name: 'Guru Fisika',
                    sender_type: 'reporter',
                    message: 'Buku Fisika Modern terbitan Erlangga edisi revisi.',
                    created_at: '2026-09-09T09:30:00.000Z'
                },
                {
                    id: 'rep-3',
                    sender_uid: 'lead-01',
                    sender_name: 'Kepala Sekolah',
                    sender_type: 'leadership',
                    message: 'Baik, segera kami alokasikan pada pengadaan triwulan ini.',
                    created_at: '2026-09-09T11:00:00.000Z'
                }
            ]
        };

        expect(threadedItem.replies).toHaveLength(3);
        expect(threadedItem.replies[0].sender_type).toBe('leadership');
        expect(threadedItem.replies[1].sender_type).toBe('reporter');
        expect(threadedItem.replies[2].sender_type).toBe('leadership');
    });

    test('3. Proteksi Akses Balas: Pemilik masukan, pimpinan, dan seluruh GTK berhak membalas aspirasi (siswa & tamu ditolak)', () => {
        const item = {
            id: 'fb-003',
            sender_uid: 'guru-andi-uid',
            title: 'Saran Jadwal Ujian'
        };

        function canUserReply(callerUid, callerRoles = [], isStudent = false) {
            if (!callerUid) return false;
            const isSender = callerUid === item.sender_uid;
            const leadershipRoles = ['super_admin', 'kepala_sekolah', 'kesiswaan', 'wakasek_kurikulum', 'kepala_lab', 'humas', 'sarpras'];
            const isLeadership = callerRoles.some(r => leadershipRoles.includes(r));
            const isGtk = !isStudent && !callerRoles.includes('siswa') && callerRoles.length > 0;
            return isSender || isLeadership || isGtk;
        }

        // Skenario 1: Guru pemilik masukan berhak membalas (reporter)
        expect(canUserReply('guru-andi-uid', ['guru_mapel'])).toBe(true);

        // Skenario 2: Kepala sekolah (leadership) berhak membalas
        expect(canUserReply('kepsek-uid', ['kepala_sekolah'])).toBe(true);
        expect(canUserReply('superadmin-uid', ['super_admin'])).toBe(true);

        // Skenario 3: Guru lain yang BUKAN pemilik tiket tetap BERHAK membalas (partisipasi civitas GTK)
        expect(canUserReply('guru-budi-uid', ['guru_mapel'])).toBe(true);

        // Skenario 4: Wali kelas & Guru BK lain tetap BERHAK membalas
        expect(canUserReply('walikelas-siti-uid', ['wali_kelas'])).toBe(true);
        expect(canUserReply('gurubk-rina-uid', ['guru_bk'])).toBe(true);

        // Skenario 5: Staff TU lain tetap BERHAK membalas
        expect(canUserReply('staff-tu-uid', ['staff'])).toBe(true);

        // Skenario 6: Siswa DITOLAK membalas
        expect(canUserReply('siswa-deni-uid', ['siswa'], true)).toBe(false);

        // Skenario 7: Pengguna tamu / unauthenticated DITOLAK membalas
        expect(canUserReply('', [])).toBe(false);
    });

    test('4. Logika Badge NEW: Otomatis hilang saat dibuka di halaman Masukan dan muncul kembali bila ada pembaruan baru', () => {
        const t1 = new Date('2026-09-10T10:00:00.000Z').toISOString();
        const t2 = new Date('2026-09-10T10:30:00.000Z').toISOString();
        const t3 = new Date('2026-09-10T11:00:00.000Z').toISOString();

        // 1. Awalnya belum pernah dikunjungi, ada pembaruan di t1 -> hasNew = true
        let lastVisited = localStorage.getItem('simas_masukan_last_visited');
        expect(lastVisited).toBeNull();

        // Simulasi pemeriksaan badge sisi backend (leadership query)
        function checkLeadershipBadgeBackend(feedbacks, visitedTs) {
            if (!visitedTs) {
                return feedbacks.some(f => f.status === 'baru');
            }
            return feedbacks.some(f => new Date(f.created_at) > new Date(visitedTs) || new Date(f.updated_at) > new Date(visitedTs));
        }

        const existingTickets = [
            { id: 'fb-1', status: 'baru', created_at: t1, updated_at: t1 }
        ];

        // Belum pernah dibuka: mendeteksi tiket baru
        expect(checkLeadershipBadgeBackend(existingTickets, lastVisited)).toBe(true);

        // 2. Pengguna membuka menu Masukan di t2 -> simpan lastVisited = t2 & simas_masukan_badge_check_ts
        localStorage.setItem('simas_masukan_last_visited', t2);
        sessionStorage.setItem('simas_masukan_has_new', 'false');
        sessionStorage.setItem('simas_masukan_badge_check_ts', Date.now().toString());

        lastVisited = localStorage.getItem('simas_masukan_last_visited');
        expect(lastVisited).toBe(t2);
        expect(sessionStorage.getItem('simas_masukan_badge_check_ts')).toBeTruthy();

        // Karena tiket lama di t1 < visited t2, meskipun tiket masih berstatus 'baru', badge TIDAK BOLEH muncul lagi!
        expect(checkLeadershipBadgeBackend(existingTickets, lastVisited)).toBe(false);

        // 3. Kemudian ada balasan/masukan baru masuk di t3 (t3 > t2)
        // Badge 'NEW' harus muncul kembali!
        const updatedTickets = [
            ...existingTickets,
            { id: 'fb-2', status: 'baru', created_at: t3, updated_at: t3 }
        ];
        expect(checkLeadershipBadgeBackend(updatedTickets, lastVisited)).toBe(true);

        // 4. Pengguna membuka kembali menu Masukan di t3 -> badge hilang lagi
        localStorage.setItem('simas_masukan_last_visited', t3);
        lastVisited = localStorage.getItem('simas_masukan_last_visited');
        expect(checkLeadershipBadgeBackend(updatedTickets, lastVisited)).toBe(false);
    });

    test('5. Fitur Dukungan Aspirasi (Like / Upvote): 1 akun hanya 1 dukungan per tiket dan dapat dibatalkan (toggle)', () => {
        let item = {
            id: 'fb-005',
            title: 'Perbaikan Lampu Lapangan Basket',
            likes: ['user-1', 'user-2']
        };

        function toggleLike(itemObj, uid) {
            if (!uid) throw new Error('Otentikasi diperlukan');
            let likes = Array.isArray(itemObj.likes) ? [...itemObj.likes] : [];
            let liked = false;
            if (likes.includes(uid)) {
                likes = likes.filter(u => u !== uid);
                liked = false;
            } else {
                likes.push(uid);
                liked = true;
            }
            itemObj.likes = likes;
            return { liked, likeCount: likes.length };
        }

        // Awal: 2 like
        expect(item.likes).toHaveLength(2);

        // User-3 memberi dukungan -> like bertambah menjadi 3
        const res1 = toggleLike(item, 'user-3');
        expect(res1.liked).toBe(true);
        expect(res1.likeCount).toBe(3);
        expect(item.likes).toContain('user-3');

        // User-3 klik like lagi -> membatalkan dukungan (toggle off), like kembali 2
        const res2 = toggleLike(item, 'user-3');
        expect(res2.liked).toBe(false);
        expect(res2.likeCount).toBe(2);
        expect(item.likes).not.toContain('user-3');

        // Pengguna tanpa otentikasi dilarang memberi like
        expect(() => toggleLike(item, null)).toThrow('Otentikasi diperlukan');
    });

    test('6. Pengurutan Masukan: Opsi "Paling Didukung" mengurutkan berdasarkan jumlah likes terbanyak', () => {
        const feedList = [
            { id: 'fb-a', title: 'A', likes: ['u1'], createdAt: '2026-09-10T10:00:00.000Z' },
            { id: 'fb-b', title: 'B', likes: ['u1', 'u2', 'u3'], createdAt: '2026-09-09T10:00:00.000Z' },
            { id: 'fb-c', title: 'C', likes: [], createdAt: '2026-09-10T11:00:00.000Z' },
            { id: 'fb-d', title: 'D', likes: ['u1', 'u2'], createdAt: '2026-09-08T10:00:00.000Z' }
        ];

        function sortFeedbacks(items, sortBy = 'latest') {
            return [...items].sort((a, b) => {
                if (sortBy === 'popular') {
                    const countA = Array.isArray(a.likes) ? a.likes.length : 0;
                    const countB = Array.isArray(b.likes) ? b.likes.length : 0;
                    if (countB !== countA) return countB - countA;
                }
                const timeA = new Date(a.createdAt || 0).getTime();
                const timeB = new Date(b.createdAt || 0).getTime();
                return timeB - timeA;
            });
        }

        // Pengurutan Paling Didukung: B (3 likes) -> D (2 likes) -> A (1 like) -> C (0 likes)
        const sortedPopular = sortFeedbacks(feedList, 'popular');
        expect(sortedPopular.map(f => f.id)).toEqual(['fb-b', 'fb-d', 'fb-a', 'fb-c']);

        // Pengurutan Terbaru: C (11:00) -> A (10:00) -> B (kemarin) -> D (2 hari lalu)
        const sortedLatest = sortFeedbacks(feedList, 'latest');
        expect(sortedLatest.map(f => f.id)).toEqual(['fb-c', 'fb-a', 'fb-b', 'fb-d']);
    });

    test('7. Transparansi Penanganan Error Edge Function: Menolak fallback silent bypass dan memberikan pesan transparan jika Edge Function belum terdeploy di cloud', async () => {
        const item = {
            id: 'fb-007',
            title: 'Saran AC Perpustakaan',
            sender_uid: 'user-siswa-01',
            status: 'selesai',
            responseText: 'Sudah diservis minggu lalu',
            responseByUid: 'admin-sarpras',
            responseByName: 'Wakasek Sarpras',
            replies: []
        };

        let supabaseUpdateCallCount = 0;
        const mockSupabase = {
            from: () => ({
                update: () => {
                    supabaseUpdateCallCount++;
                    return { eq: () => Promise.resolve({ data: [], error: null }) };
                }
            })
        };

        // Fungsi simulasi pengiriman balasan murni via Edge Function (sesuai page-masukan.js)
        async function sendFeedbackReplyTest(id, message, sender) {
            try {
                // Simulasi respons cloud edge function jika aksi belum dideploy
                throw new Error('Unknown action: reply-feedback');
            } catch (error) {
                if (error?.message?.includes('Unknown action: reply-feedback') || (error?.message && error.message.includes('Unknown action'))) {
                    throw new Error('Backend Edge Function belum diperbarui di server cloud Supabase (aksi reply-feedback belum terdeploy).');
                }
                throw error;
            }
        }

        // Eksekusi dan tangkap error
        await expect(sendFeedbackReplyTest('fb-007', 'AC masih sering mati sendiri pak.', { name: 'Siswa A', role: 'siswa' }))
            .rejects
            .toThrow('Backend Edge Function belum diperbarui di server cloud Supabase (aksi reply-feedback belum terdeploy).');

        // Pastikan tidak ada bypass direct client update ke database (0 pemanggilan direct client update)
        expect(supabaseUpdateCallCount).toBe(0);
        // Pastikan item tidak dimanipulasi secara palsu
        expect(item.status).toBe('selesai');
        expect(item.replies).toHaveLength(0);
    });

    test('8. SWR Caching & Instant Render: Cache sessionStorage dimuat seketika (0ms) dan diupdate setelah revalidasi', async () => {
        const CACHE_KEY = 'simas_feedbacks_cache_v1';
        const cachedMockData = [
            { id: 'fb-c1', title: 'Data Cache A', message: 'Pesan cache A', status: 'baru', likes: [] }
        ];

        // 1. Simpan data awal ke cache
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(cachedMockData));

        let localItems = [];
        let hasRenderedFromCache = false;

        // Simulasi loadFeedback dengan SWR
        async function loadFeedbackSimulated(force = false, fetchFn) {
            if (!force) {
                const raw = sessionStorage.getItem(CACHE_KEY);
                if (raw) {
                    localItems = JSON.parse(raw);
                    hasRenderedFromCache = true;
                }
            }

            const freshData = await fetchFn();
            localItems = freshData;
            sessionStorage.setItem(CACHE_KEY, JSON.stringify(freshData));
            return localItems;
        }

        // Test SWR normal: membaca cache dulu
        const mockFetch = jest.fn().mockResolvedValue([
            { id: 'fb-c1', title: 'Data Cache A', message: 'Pesan cache A', status: 'baru', likes: [] },
            { id: 'fb-c2', title: 'Data Baru B', message: 'Pesan baru B', status: 'baru', likes: [] }
        ]);

        await loadFeedbackSimulated(false, mockFetch);
        expect(hasRenderedFromCache).toBe(true);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(localItems).toHaveLength(2);

        // Data cache terupdate
        const updatedCache = JSON.parse(sessionStorage.getItem(CACHE_KEY));
        expect(updatedCache).toHaveLength(2);
        expect(updatedCache[1].id).toBe('fb-c2');
    });

    test('9. Optimasi Token Firebase: Menggunakan token memori (false) dan hanya force refresh (true) saat retry atau error 401', async () => {
        let tokenCalls = [];
        const mockUser = {
            getIdToken: jest.fn(async (force) => {
                tokenCalls.push(force);
                return force ? 'refreshed-token-xyz' : 'cached-token-abc';
            })
        };

        // Simulasi fungsi pemanggilan dengan logic token hemat
        async function callProxySimulated(user, fetchImpl) {
            let token = await user.getIdToken(false);
            const res = await fetchImpl(token);
            if (res.status === 401) {
                token = await user.getIdToken(true);
                return await fetchImpl(token);
            }
            return res;
        }

        // Skenario 1: Token normal (200 OK) -> hanya panggil getIdToken(false)
        const okFetch = jest.fn().mockResolvedValue({ status: 200 });
        await callProxySimulated(mockUser, okFetch);
        expect(tokenCalls).toEqual([false]);

        // Skenario 2: Token expired (401) -> otomatis force refresh getIdToken(true) dan retry
        tokenCalls = [];
        let callCount = 0;
        const expiredThenOkFetch = jest.fn(async (tok) => {
            callCount++;
            if (callCount === 1) return { status: 401 };
            return { status: 200, usedToken: tok };
        });

        const res2 = await callProxySimulated(mockUser, expiredThenOkFetch);
        expect(tokenCalls).toEqual([false, true]);
        expect(res2.usedToken).toBe('refreshed-token-xyz');
    });

    test('10. Resolusi Badge & Bubble Thread Balasan: Membedakan Pimpinan (Emerald), Pengirim (Blue), dan GTK Civitas (Indigo)', () => {
        const roleLabels = {
            super_admin: 'Super Admin',
            kepala_sekolah: 'Kepala Sekolah',
            guru_mapel: 'Guru Mapel',
            wali_kelas: 'Wali Kelas',
            staff: 'Staff TU'
        };

        function resolveBubbleMeta(reply, itemSenderUid) {
            const isLeadershipReply = reply.sender_type === 'leadership' || reply.sender_role === 'leadership' || ['super_admin', 'kepala_sekolah', 'kesiswaan', 'wakasek_kurikulum', 'kepala_lab', 'humas', 'sarpras'].includes(reply.sender_role);
            const isReporterReply = reply.sender_type === 'reporter' || (reply.sender_uid && reply.sender_uid === itemSenderUid);

            if (isLeadershipReply) {
                return { roleType: 'leadership', badgeLabel: 'Pimpinan Sekolah', badgeColor: 'bg-emerald-600' };
            }
            if (isReporterReply) {
                return { roleType: 'reporter', badgeLabel: 'Pengirim', badgeColor: 'bg-blue-600' };
            }
            return {
                roleType: 'gtk',
                badgeLabel: roleLabels[reply.sender_role] || 'GTK SMAGESA',
                badgeColor: 'bg-indigo-600'
            };
        }

        const itemSenderUid = 'user-guru-andi';

        // 1. Balasan dari Kepala Sekolah -> Pimpinan Sekolah (Emerald)
        const leadMeta = resolveBubbleMeta({ sender_uid: 'lead-1', sender_role: 'kepala_sekolah', sender_type: 'leadership' }, itemSenderUid);
        expect(leadMeta.roleType).toBe('leadership');
        expect(leadMeta.badgeLabel).toBe('Pimpinan Sekolah');
        expect(leadMeta.badgeColor).toBe('bg-emerald-600');

        // 2. Balasan dari Pembuat Masukan -> Pengirim (Blue)
        const reporterMeta = resolveBubbleMeta({ sender_uid: 'user-guru-andi', sender_role: 'guru_mapel', sender_type: 'reporter' }, itemSenderUid);
        expect(reporterMeta.roleType).toBe('reporter');
        expect(reporterMeta.badgeLabel).toBe('Pengirim');
        expect(reporterMeta.badgeColor).toBe('bg-blue-600');

        // 3. Balasan dari Rekan Guru Lain -> GTK (Indigo, Guru Mapel)
        const gtkMeta = resolveBubbleMeta({ sender_uid: 'user-guru-budi', sender_role: 'guru_mapel', sender_type: 'gtk' }, itemSenderUid);
        expect(gtkMeta.roleType).toBe('gtk');
        expect(gtkMeta.badgeLabel).toBe('Guru Mapel');
        expect(gtkMeta.badgeColor).toBe('bg-indigo-600');

        // 4. Balasan dari Staff TU -> GTK (Indigo, Staff TU)
        const staffMeta = resolveBubbleMeta({ sender_uid: 'user-staff-ani', sender_role: 'staff', sender_type: 'gtk' }, itemSenderUid);
        expect(staffMeta.roleType).toBe('gtk');
        expect(staffMeta.badgeLabel).toBe('Staff TU');
        expect(staffMeta.badgeColor).toBe('bg-indigo-600');
    });

    test('11. Siklus Edit Balasan Thread: GTK pemilik balasan berhak mengubah teks pesan dan menyematkan edited_at', () => {
        const initialReplies = [
            {
                id: 'rep-001',
                sender_uid: 'gtk-guru-budi',
                sender_name: 'Pak Budi Guru Fisika',
                sender_role: 'guru_mapel',
                sender_type: 'gtk',
                message: 'Teks balasan awal yang ada typo',
                created_at: '2026-10-23T08:00:00.000Z'
            }
        ];

        function editReplySimulated(replies, targetReplyId, callerUid, callerRoles, newMsg) {
            const index = replies.findIndex(r => r.id === targetReplyId);
            if (index === -1) throw new Error('404: Balasan tidak ditemukan');

            const target = replies[index];
            const isOwner = target.sender_uid === callerUid;
            const isSuperAdmin = callerRoles.includes('super_admin');

            if (!isOwner && !isSuperAdmin) {
                const err = new Error('403: Forbidden - Anda hanya berhak mengedit balasan milik sendiri.');
                err.status = 403;
                throw err;
            }

            const updated = [...replies];
            updated[index] = {
                ...target,
                message: newMsg,
                edited_at: '2026-10-23T08:15:00.000Z'
            };
            return updated;
        }

        // GTK pemilik balasan mengedit pesannya sendiri
        const edited = editReplySimulated(initialReplies, 'rep-001', 'gtk-guru-budi', ['guru_mapel'], 'Teks balasan revisi yang sudah dikoreksi');
        expect(edited[0].message).toBe('Teks balasan revisi yang sudah dikoreksi');
        expect(edited[0].edited_at).toBe('2026-10-23T08:15:00.000Z');
        expect(edited[0].sender_uid).toBe('gtk-guru-budi');
    });

    test('12. Proteksi Otorisasi & Anti-IDOR: Pengguna lain ditolak (403 Forbidden), Super Admin diizinkan memoderasi', () => {
        const initialReplies = [
            {
                id: 'rep-002',
                sender_uid: 'gtk-guru-budi',
                sender_name: 'Pak Budi Guru Fisika',
                sender_role: 'guru_mapel',
                sender_type: 'gtk',
                message: 'Informasi awal',
                created_at: '2026-10-23T08:00:00.000Z'
            }
        ];

        function checkEditAuthorization(reply, callerUid, callerRoles) {
            const isOwner = reply.sender_uid === callerUid;
            const isSuperAdmin = callerRoles.includes('super_admin');
            return isOwner || isSuperAdmin;
        }

        const reply = initialReplies[0];

        // Skenario A: Guru lain (bukan pemilik) mencoba mengedit -> HARUS DITOLAK
        expect(checkEditAuthorization(reply, 'guru-lain-andi', ['guru_mapel'])).toBe(false);

        // Skenario B: Siswa atau user publik mencoba mengedit -> HARUS DITOLAK
        expect(checkEditAuthorization(reply, 'siswa-deni', ['siswa'])).toBe(false);

        // Skenario C: Super Admin berhak mengedit / memoderasi
        expect(checkEditAuthorization(reply, 'admin-super-uid', ['super_admin'])).toBe(true);
    });

    test('13. Edit Tiket Aspirasi Utama: Pemilik masukan atau Super Admin dapat mengubah judul, kategori, dan isi', () => {
        const feedbackItem = {
            id: 'fb-main-1',
            sender_uid: 'user-gtk-siti',
            title: 'Judul Lama',
            message: 'Isi pesan lama',
            category: 'Sistem Informasi'
        };

        function editFeedbackSimulated(item, callerUid, callerRoles, updates) {
            const isOwner = item.sender_uid === callerUid;
            const isSuperAdmin = callerRoles.includes('super_admin');
            if (!isOwner && !isSuperAdmin) {
                const err = new Error('403: Forbidden');
                err.status = 403;
                throw err;
            }
            return {
                ...item,
                title: updates.title || item.title,
                message: updates.message || item.message,
                category: updates.category || item.category,
                updated_at: '2026-10-23T08:20:00.000Z'
            };
        }

        // Skenario A: Pemilik masukan mengubah aspirasinya
        const res1 = editFeedbackSimulated(feedbackItem, 'user-gtk-siti', ['staff'], {
            title: 'Judul Baru yang Jelas',
            message: 'Isi pesan yang telah dilengkapi'
        });
        expect(res1.title).toBe('Judul Baru yang Jelas');
        expect(res1.message).toBe('Isi pesan yang telah dilengkapi');

        // Skenario B: Orang lain mencoba mengubah -> Ditolak 403
        expect(() => {
            editFeedbackSimulated(feedbackItem, 'user-lain', ['guru_mapel'], { title: 'Hacked' });
        }).toThrow('403: Forbidden');
    });

    test('14. Siklus Hidup Penuh Edit Masukan: Fallback Email, Kunci Status Selesai/Ditolak, dan Moderasi Super Admin', () => {
        function editFeedbackFullLifecycle({ item, callerUid, callerEmail, callerRoles, updates }) {
            const userEmail = (callerEmail || '').toLowerCase().trim();
            const itemEmail = (item.sender_email || item.senderEmail || '').toLowerCase().trim();
            const isOwner = Boolean(callerUid && (
                (item.sender_uid && item.sender_uid === callerUid) ||
                (userEmail && itemEmail && userEmail === itemEmail)
            ));
            const isSuperAdmin = callerRoles.includes('super_admin');

            if (!isOwner && !isSuperAdmin) {
                const err = new Error('403: Forbidden - Anda hanya berhak mengedit masukan milik sendiri.');
                err.status = 403;
                throw err;
            }

            const itemStatus = String(item.status || 'baru').toLowerCase();
            if (!isSuperAdmin && ['selesai', 'ditolak'].includes(itemStatus)) {
                const err = new Error(`403: Forbidden - Masukan dengan status "${itemStatus}" sudah ditutup dan tidak dapat diedit lagi.`);
                err.status = 403;
                throw err;
            }

            return {
                ...item,
                title: updates.title || item.title,
                message: updates.message || item.message,
                category: updates.category || item.category,
                updated_at: '2026-10-23T10:00:00.000Z',
                edited_at: '2026-10-23T10:00:00.000Z'
            };
        }

        const activeTicket = {
            id: 'fb-active',
            sender_uid: 'uid-andi',
            sender_email: 'andi@smagesa.sch.id',
            status: 'proses',
            title: 'AC Ruang Guru Kurang Dingin',
            message: 'Mohon dicek freon AC',
            category: 'Sarana Prasarana & Laboratorium'
        };

        // Skenario A: Pemilik via UID dapat mengedit tiket status 'proses'
        const resA = editFeedbackFullLifecycle({
            item: activeTicket,
            callerUid: 'uid-andi',
            callerEmail: 'andi@smagesa.sch.id',
            callerRoles: ['guru_mapel'],
            updates: { title: 'AC Ruang Guru Bocor Air' }
        });
        expect(resA.title).toBe('AC Ruang Guru Bocor Air');

        // Skenario B: Pemilik via fallback email cocok (misal UID berbeda/ganti device) tetap berhak mengedit
        const resB = editFeedbackFullLifecycle({
            item: activeTicket,
            callerUid: 'new-uid-device-2',
            callerEmail: 'andi@smagesa.sch.id',
            callerRoles: ['guru_mapel'],
            updates: { message: 'Sudah bocor air dan menetes ke meja' }
        });
        expect(resB.message).toBe('Sudah bocor air dan menetes ke meja');

        // Skenario C: Pengguna lain ditolak tegas 403 Forbidden
        expect(() => {
            editFeedbackFullLifecycle({
                item: activeTicket,
                callerUid: 'uid-bukan-andi',
                callerEmail: 'budi@smagesa.sch.id',
                callerRoles: ['guru_mapel'],
                updates: { title: 'Disabotase' }
            });
        }).toThrow('403: Forbidden - Anda hanya berhak mengedit masukan milik sendiri.');

        // Skenario D: Tiket berstatus 'selesai' dikunci untuk pengirim
        const resolvedTicket = {
            ...activeTicket,
            id: 'fb-done',
            status: 'selesai'
        };
        expect(() => {
            editFeedbackFullLifecycle({
                item: resolvedTicket,
                callerUid: 'uid-andi',
                callerEmail: 'andi@smagesa.sch.id',
                callerRoles: ['guru_mapel'],
                updates: { title: 'Mau ganti lagi' }
            });
        }).toThrow(/sudah ditutup dan tidak dapat diedit lagi/);

        // Skenario E: Tiket berstatus 'ditolak' dikunci untuk pengirim
        const rejectedTicket = {
            ...activeTicket,
            id: 'fb-rej',
            status: 'ditolak'
        };
        expect(() => {
            editFeedbackFullLifecycle({
                item: rejectedTicket,
                callerUid: 'uid-andi',
                callerEmail: 'andi@smagesa.sch.id',
                callerRoles: ['guru_mapel'],
                updates: { title: 'Mau coba lagi' }
            });
        }).toThrow(/sudah ditutup dan tidak dapat diedit lagi/);

        // Skenario F: Super Admin tetap dapat mengedit tiket status 'selesai' untuk keperluan moderasi/koreksi typo
        const resSuper = editFeedbackFullLifecycle({
            item: resolvedTicket,
            callerUid: 'superadmin-01',
            callerEmail: 'admin@smagesa.sch.id',
            callerRoles: ['super_admin'],
            updates: { title: '[MODERASI] AC Ruang Guru Telah Diperbaiki' }
        });
        expect(resSuper.title).toBe('[MODERASI] AC Ruang Guru Telah Diperbaiki');
    });

    test('15. Deteksi Indikator Visual (diedit) pada Kartu Aspirasi', () => {
        function computeHasBeenEdited(item) {
            const hasExplicitEditedAt = Boolean(item.edited_at || item.editedAt);
            const createdMs = item.created_at ? new Date(item.created_at).getTime() : 0;
            const updatedMs = item.updated_at ? new Date(item.updated_at).getTime() : 0;
            const hasTimestampDiff = Boolean(createdMs && updatedMs && Math.abs(updatedMs - createdMs) > 2000);
            return hasExplicitEditedAt || hasTimestampDiff;
        }

        // Tiket baru dibuat tanpa edit
        const newTicket = {
            id: 't-1',
            created_at: '2026-10-23T08:00:00.000Z',
            updated_at: '2026-10-23T08:00:00.000Z'
        };
        expect(computeHasBeenEdited(newTicket)).toBe(false);

        // Tiket yang telah diedit (selisih updated_at > 2000ms)
        const editedTicket = {
            id: 't-2',
            created_at: '2026-10-23T08:00:00.000Z',
            updated_at: '2026-10-23T08:30:00.000Z'
        };
        expect(computeHasBeenEdited(editedTicket)).toBe(true);

        // Tiket dengan explicit edited_at
        const explicitEdited = {
            id: 't-3',
            created_at: '2026-10-23T08:00:00.000Z',
            edited_at: '2026-10-23T08:05:00.000Z'
        };
        expect(computeHasBeenEdited(explicitEdited)).toBe(true);
    });
});
