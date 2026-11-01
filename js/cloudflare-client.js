/**
 * js/cloudflare-client.js - SIMAS Cloudflare D1 & Worker Client Helper
 * 
 * Standar Keamanan & Reliabilitas:
 * - Menghubungkan frontend SIMAS ke Cloudflare Worker API Gateway di Edge (Cloudflare D1 SQL)
 * - Otomatis menyematkan Firebase Auth ID Token (Bearer Token) pada request mutasi
 * - 100% Serverless Edge SQL (Cloudflare D1) tanpa beban Firestore Read
 */

import { auth, CLOUDFLARE_CONFIG } from './config.js';

class CloudflareClient {
    constructor() {
        this.baseUrl = (CLOUDFLARE_CONFIG && CLOUDFLARE_CONFIG.workerUrl) ? CLOUDFLARE_CONFIG.workerUrl.replace(/\/+$/, '') : '';
        this.enabled = (CLOUDFLARE_CONFIG && CLOUDFLARE_CONFIG.enabled !== false && !!this.baseUrl);
    }

    async getAuthHeader({ required = false } = {}) {
        try {
            // Jika auth belum selesai restore sesi saat inisialisasi awal, tunggu hingga 2.5 detik
            if (auth && !auth.currentUser) {
                await new Promise(resolve => {
                    const unsubscribe = auth.onAuthStateChanged(user => {
                        unsubscribe();
                        resolve(user);
                    });
                    setTimeout(resolve, 2500);
                });
            }
            if (auth && auth.currentUser) {
                const token = await auth.currentUser.getIdToken();
                return { 'Authorization': `Bearer ${token}` };
            }
        } catch (e) {
            console.warn('[CloudflareClient] Gagal mengambil Firebase Auth Token:', e);
            if (required) throw e;
        }
        if (required) {
            const error = new Error('Sesi login belum tersedia. Silakan masuk kembali.');
            error.code = 'auth/invalid-user-token';
            throw error;
        }
        return {};
    }

    /**
     * Memeriksa apakah suatu respon/error merupakan gangguan transient (sesaat)
     * seperti timeout internal Cloudflare D1 (Durable Object reset), 429 rate limit, atau gateway 502/503/504
     */
    isTransientError(status, errorMsg) {
        if ([408, 429, 502, 503, 504].includes(status)) {
            return true;
        }
        if (status === 500 && errorMsg) {
            return /D1_ERROR|timeout|exceeded timeout|caused object to be reset|reset|storage operation/i.test(errorMsg);
        }
        if (!status && errorMsg) {
            return /D1_ERROR|network\s?error|failed to fetch|load failed|timeout|caused object to be reset|network disconnected|network connection was lost/i.test(errorMsg);
        }
        return false;
    }

    async request(path, options = {}) {
        if (!this.enabled || !this.baseUrl) {
            throw new Error('Cloudflare Worker URL belum dikonfigurasi atau dinonaktifkan.');
        }

        const url = `${this.baseUrl}${path.startsWith('/') ? path : '/' + path}`;
        const method = (options.method || 'GET').toUpperCase();
        // PUT dan DELETE bersifat idempotent menurut semantik HTTP. Mengulangnya saat
        // terjadi timeout/gateway error tidak menggandakan data, dan sangat membantu
        // mutasi profil yang dilakukan tepat setelah sesi login dipulihkan.
        const isIdempotent = ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'].includes(method);

        // Opsi retry: Default 2x retry untuk GET/idempotent (total 3x percobaan), 0 untuk mutasi kecuali ditentukan eksplisit
        const maxRetries = options.maxRetries !== undefined
            ? options.maxRetries
            : (options.retries !== undefined ? options.retries : (isIdempotent ? 2 : 0));
        const baseDelay = options.retryDelay || 350;
        const { maxRetries: _maxRetries, retries: _retries, retryDelay: _retryDelay,
            timeoutMs = 0, retryStatuses, requireAuth = false, ...fetchOptions } = options;

        let lastError = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const authHeaders = await this.getAuthHeader({ required: requireAuth });

                const headers = {
                    'Content-Type': 'application/json',
                    'X-Simas-Client': 'web-v1',
                    ...(CLOUDFLARE_CONFIG && CLOUDFLARE_CONFIG.syncKey ? {
                        'X-Sync-Key': CLOUDFLARE_CONFIG.syncKey,
                        'X-Api-Key': CLOUDFLARE_CONFIG.syncKey
                    } : {}),
                    ...authHeaders,
                    ...(options.headers || {})
                };

                // Pasang X-Student-Token kriptografis jika dalam konteks siswa (pengguna anonim, di portal siswa, atau saat token siswa tersedia)
                const isStudentContext = Boolean(
                    auth?.currentUser?.isAnonymous ||
                    (typeof window !== 'undefined' && window.location?.pathname?.includes('portal-siswa')) ||
                    (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('student_token'))
                );
                if (isStudentContext && !headers['X-Student-Token']) {
                    const studentToken = (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('student_token') : null)
                        || (typeof localStorage !== 'undefined' ? localStorage.getItem('student_token') : null);
                    if (studentToken) {
                        headers['X-Student-Token'] = studentToken;
                    }
                }

                const config = {
                    ...fetchOptions,
                    headers
                };

                // Batas waktu mencakup header dan pembacaan body, dengan controller
                // baru tiap percobaan agar retry tidak memakai signal yang sudah dibatalkan.
                const controller = timeoutMs > 0 ? new AbortController() : null;
                const abortFromCaller = () => controller.abort();
                if (controller && options.signal) {
                    if (options.signal.aborted) controller.abort();
                    else options.signal.addEventListener('abort', abortFromCaller, { once: true });
                }
                let timedOut = false;
                const timeoutId = controller ? setTimeout(() => {
                    timedOut = true;
                    controller.abort();
                }, timeoutMs) : null;
                let response;
                let responseText;
                try {
                    response = await fetch(url, controller ? { ...config, signal: controller.signal } : config);
                    responseText = await response.text();
                } catch (error) {
                    if (timedOut && !options.signal?.aborted && error.code !== 'api/write-outcome-unknown') {
                        const timeoutError = new Error('Koneksi ke server melewati batas waktu.');
                        timeoutError.code = 'api/timeout';
                        throw timeoutError;
                    }
                    throw error;
                } finally {
                    if (timeoutId !== null) clearTimeout(timeoutId);
                    if (controller && options.signal) options.signal.removeEventListener('abort', abortFromCaller);
                }

                let json = null;
                try {
                    json = JSON.parse(responseText);
                } catch (_) {
                    // Respon bukan format JSON (contoh: halaman HTML 502 Bad Gateway Cloudflare)
                }

                if (!response.ok || (json && json.success === false)) {
                    const errorMsg = (json && (json.error || json.message))
                        ? (json.error || json.message)
                        : (responseText && responseText.length < 200 ? responseText : `HTTP ${response.status} - Gagal memproses permintaan.`);

                    const responseError = new Error(errorMsg);
                    responseError.status = response.status;
                    if (json?.code === 'api/write-outcome-unknown') responseError.code = json.code;
                    if (json?.conflict_kbm) {
                        responseError.conflict_kbm = true;
                        responseError.kbm = json.kbm;
                    }
                    responseError.payload = json;
                    throw responseError;
                }

                if (attempt > 0) {
                    console.info(`[CloudflareClient] Permintaan ${method} ${path} berhasil dipulihkan pada percobaan ke-${attempt + 1}.`);
                }

                return json || {};
            } catch (err) {
                lastError = err;
                const isTransient = !options.signal?.aborted
                    && err.code !== 'api/write-outcome-unknown'
                    && (err.code === 'api/timeout' || this.isTransientError(err.status || 0, err.message))
                    && (!retryStatuses || !err.status || retryStatuses.includes(err.status));
                if (!err.status && !err.code && isTransient) err.code = 'api/network-request-failed';

                if (isTransient && attempt < maxRetries) {
                    const delay = (baseDelay * Math.pow(2, attempt)) + Math.floor(Math.random() * 100);
                    console.warn(`[CloudflareClient] Koneksi terputus/timeout pada ${method} ${path} (${err.message}). Mencoba ulang (${attempt + 1}/${maxRetries}) dalam ${delay}ms...`);
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }

                throw err;
            }
        }

        throw lastError || new Error(`Gagal memproses permintaan setelah ${maxRetries + 1} percobaan.`);
    }

    // ==========================================
    // 📅 AGENDA & CALENDAR EVENTS
    // ==========================================

    async getAgendaEvents(year, month) {
        let path = '/api/agenda/events';
        if (year && month) {
            path += `?year=${year}&month=${month}`;
        } else if (year) {
            path += `?year=${year}`;
        }
        const res = await this.request(path, { method: 'GET' });
        const list = (res && Array.isArray(res.data)) ? res.data : (Array.isArray(res) ? res : []);
        return list.map(ev => ({
            ...ev,
            type: ev.type || ev.category || 'kegiatan',
            category: ev.category || ev.type || 'kegiatan',
            endDate: ev.endDate || (ev.time && /^\d{4}-\d{2}-\d{2}$/.test(ev.time) ? ev.time : null)
        }));
    }

    async getCalendarEvents(year, month) {
        let path = '/api/agenda/events';
        if (year && month) {
            path += `?year=${year}&month=${month}`;
        } else if (year) {
            path += `?year=${year}`;
        }
        const res = await this.request(path, { method: 'GET' });
        const rawList = (res && Array.isArray(res.data)) ? res.data : (Array.isArray(res) ? res : []);
        const mappedList = rawList.map(ev => ({
            ...ev,
            type: ev.type || ev.category || 'kegiatan',
            category: ev.category || ev.type || 'kegiatan',
            endDate: ev.endDate || (ev.time && /^\d{4}-\d{2}-\d{2}$/.test(ev.time) ? ev.time : null)
        }));
        return { success: true, data: mappedList };
    }

    async saveAgendaEvent(eventData, isEdit = false, id = null) {
        const payload = {
            ...eventData,
            category: eventData.category || eventData.type || 'kegiatan',
            type: eventData.type || eventData.category || 'kegiatan',
            time: eventData.time || eventData.endDate || '',
            color: eventData.color || (eventData.type === 'libur' || eventData.category === 'libur' ? 'rose' : (eventData.type === 'penting' || eventData.category === 'penting' ? 'amber' : 'blue'))
        };
        if (isEdit && id) {
            return await this.request(`/api/agenda/events/${id}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
        } else {
            return await this.request('/api/agenda/events', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
        }
    }

    async createCalendarEvent(eventData) {
        return await this.saveAgendaEvent(eventData, false);
    }

    async createCalendarEventsBatch(eventsList) {
        return await this.request('/api/agenda/events', {
            method: 'POST',
            body: JSON.stringify({ events: eventsList })
        });
    }

    async updateCalendarEvent(id, eventData) {
        return await this.saveAgendaEvent(eventData, true, id);
    }

    async deleteAgendaEvent(id, seriesTag = null) {
        const path = seriesTag ? `/api/agenda/events/${id}?series=${encodeURIComponent(seriesTag)}` : `/api/agenda/events/${id}`;
        return await this.request(path, {
            method: 'DELETE'
        });
    }

    async deleteCalendarEvent(id, seriesTag = null) {
        return await this.deleteAgendaEvent(id, seriesTag);
    }

    // ==========================================
    // 📂 AGENDA DOCUMENTS
    // ==========================================

    async getAgendaDocuments(category = 'all') {
        const path = `/api/agenda/documents?category=${encodeURIComponent(category)}`;
        const res = await this.request(path, { method: 'GET' });
        return res.data || [];
    }

    async saveAgendaDocument(docData, isEdit = false, id = null) {
        if (isEdit && id) {
            return await this.request(`/api/agenda/documents/${id}`, {
                method: 'PUT',
                body: JSON.stringify(docData)
            });
        } else {
            return await this.request('/api/agenda/documents', {
                method: 'POST',
                body: JSON.stringify(docData)
            });
        }
    }

    async deleteAgendaDocument(id) {
        return await this.request(`/api/agenda/documents/${id}`, {
            method: 'DELETE'
        });
    }

    // ==========================================
    // 🔐 LOGIN HISTORY (TELEMETRI)
    // ==========================================

    async logLogin(loginData) {
        try {
            return await this.request('/api/login-history', {
                method: 'POST',
                body: JSON.stringify(loginData)
            });
        } catch (e) {
            console.warn('[CloudflareClient] Gagal merekam log login:', e.message);
            return { success: false, error: e.message };
        }
    }

    async getLoginHistory(filters = {}) {
        let path = '/api/login-history';
        const params = new URLSearchParams();
        if (filters.start) params.append('start', filters.start);
        if (filters.end) params.append('end', filters.end);
        if (filters.role && filters.role !== 'all') params.append('role', filters.role);
        if (filters.limit) params.append('limit', filters.limit);
        if (filters.offset) params.append('offset', filters.offset);

        const qs = params.toString();
        if (qs) path += `?${qs}`;

        const res = await this.request(path, { method: 'GET' });
        return res.data || [];
    }

    // ==========================================
    // 🛡️ AUDIT LOGS (JEJAK AUDIT KEAMANAN)
    // ==========================================

    async logAudit(auditData) {
        try {
            return await this.request('/api/audit-logs', {
                method: 'POST',
                body: JSON.stringify(auditData)
            });
        } catch (e) {
            console.warn('[CloudflareClient] Gagal merekam jejak audit:', e.message);
            return { success: false, error: e.message };
        }
    }

    async getAuditLogs(filters = {}) {
        let path = '/api/audit-logs';
        const params = new URLSearchParams();
        if (filters.start) params.append('start', filters.start);
        if (filters.end) params.append('end', filters.end);
        if (filters.action && filters.action !== 'all') params.append('action', filters.action);
        if (filters.limit) params.append('limit', filters.limit);
        if (filters.offset) params.append('offset', filters.offset);

        const qs = params.toString();
        if (qs) path += `?${qs}`;

        const res = await this.request(path, { method: 'GET' });
        return res.data || [];
    }

    // ==========================================
    // 🎓 MASTER DATA SISWA & DAPODIK (PRIMARY DB)
    // ==========================================

    async getStudents(filters = {}) {
        let path = '/api/students';
        const params = new URLSearchParams();
        if (filters.class && filters.class !== 'all' && filters.class !== 'Semua') params.append('class', filters.class);
        if (filters.status && filters.status !== 'all') params.append('status', filters.status);
        if (filters.search || filters.q) params.append('search', filters.search || filters.q);
        if (filters.limit) params.append('limit', filters.limit);
        if (filters.offset) params.append('offset', filters.offset);

        const qs = params.toString();
        if (qs) path += `?${qs}`;

        const res = await this.request(path, { method: 'GET' });
        return res.data || [];
    }

    async getStudentByNis(nis) {
        if (!nis) throw new Error('NIS siswa wajib disertakan.');
        const res = await this.request(`/api/students/${encodeURIComponent(String(nis).trim())}`, { method: 'GET' });
        return res.data || null;
    }

    async saveStudent(studentData, isEdit = false) {
        const nis = String(studentData.nis || studentData.id || '').trim();
        if (!nis) throw new Error('NIS siswa wajib disertakan.');

        if (isEdit) {
            return await this.request(`/api/students/${encodeURIComponent(nis)}`, {
                method: 'PUT',
                body: JSON.stringify(studentData)
            });
        } else {
            return await this.request('/api/students', {
                method: 'POST',
                body: JSON.stringify(studentData)
            });
        }
    }

    async deleteStudent(nis) {
        if (!nis) throw new Error('NIS siswa wajib disertakan.');
        return await this.request(`/api/students/${encodeURIComponent(String(nis).trim())}`, {
            method: 'DELETE'
        });
    }

    async bulkSyncStudents(studentsList, migrationKey = null) {
        if (!Array.isArray(studentsList) || studentsList.length === 0) {
            return { success: true, migratedCount: 0 };
        }

        const headers = {};
        if (migrationKey) {
            headers['X-Migration-Key'] = migrationKey;
        }

        return await this.request('/api/students/bulk-sync', {
            method: 'POST',
            headers,
            body: JSON.stringify({ students: studentsList })
        });
    }

    async transferStudentClass({ nis, from_class, to_class, academic_year = '' }) {
        return await this.request('/api/students/transfer-class', {
            method: 'POST',
            body: JSON.stringify({
                nis,
                from_class,
                to_class,
                academic_year
            })
        });
    }

    async getAlumniClasses() {
        const res = await this.request('/api/students/alumni-classes', {
            method: 'GET'
        });
        return res.data || [];
    }

    async cleanupAlumniClass(targetClass, options = {}) {
        if (!targetClass) throw new Error('Nama kelas alumni wajib disertakan.');
        return await this.request('/api/students/cleanup-alumni-class', {
            method: 'POST',
            body: JSON.stringify({
                class: String(targetClass).trim(),
                delete_records: options.delete_records !== false,
                delete_bk: options.delete_bk !== false
            })
        });
    }

    async uploadStudentPhoto({ nis, photoBase64, image, format = 'webp', autoVerify = false }) {
        const imgData = photoBase64 || image;
        if (!nis || !imgData) throw new Error('NIS dan data foto wajib disertakan.');
        return await this.request('/api/students/photo/upload', {
            method: 'POST',
            body: JSON.stringify({ nis, photoBase64: imgData, image: imgData, format, autoVerify })
        });
    }

    async deleteStudentPhoto(nis) {
        if (!nis) throw new Error('NIS siswa wajib disertakan.');
        return await this.request(`/api/students/photo/${encodeURIComponent(String(nis).trim())}`, {
            method: 'DELETE'
        });
    }

    async uploadGtkPhoto({ gtkId, photoBase64, image }) {
        const imgData = photoBase64 || image;
        if (!imgData) throw new Error('Data foto WebP base64 wajib disertakan.');
        return await this.request('/api/gtk/photo/upload', {
            method: 'POST',
            body: JSON.stringify({ gtkId: gtkId || '', photoBase64: imgData, image: imgData })
        });
    }

    async deleteGtkPhoto(gtkId) {
        if (!gtkId) throw new Error('ID GTK wajib disertakan.');
        return await this.request(`/api/gtk/photo/${encodeURIComponent(String(gtkId).trim())}`, {
            method: 'DELETE'
        });
    }

    async verifyStudentPhoto({ nis, action, rejectionReason = '' }) {
        if (!nis || !action) throw new Error('NIS dan tindakan verifikasi (action) wajib disertakan.');
        return await this.request('/api/students/photo/verify', {
            method: 'POST',
            body: JSON.stringify({ nis, action, rejectionReason })
        });
    }

    async getStudentPhotoInfo(nis) {
        if (!nis) throw new Error('NIS wajib disertakan.');
        return await this.request(`/api/students/photo/info/${encodeURIComponent(String(nis).trim())}`, {
            method: 'GET'
        });
    }

    /** Terjemahkan token QR kartu (public_token atau kts_) menjadi NIS. Khusus staf; kunci kartu hanya ada di server. */
    async resolveStudentCardToken(token) {
        if (!token) throw new Error('Token kartu wajib disertakan.');
        return await this.request(`/api/students/resolve-card/${encodeURIComponent(String(token).trim())}`, {
            method: 'GET'
        });
    }

    async getPublicStudentCard(token) {
        if (!token) throw new Error('Token verifikasi wajib disertakan.');
        return await this.request(`/api/students/public-card/${encodeURIComponent(String(token).trim())}`, {
            method: 'GET'
        });
    }

    async promoteClasses({ academicYear = '' } = {}) {
        return await this.request('/api/students/promote-classes', {
            method: 'POST',
            body: JSON.stringify({ academicYear: String(academicYear || '').trim() })
        });
    }

    // Annual-reset calls are explicit phases; legacy mutation methods above fail closed on the server.
    async annualResetAction(action, payload = {}) {
        return this.request('/api/students/annual-reset', {
            method: 'POST', body: JSON.stringify({ ...payload, action })
        });
    }

    async getAnnualResetHistory() {
        return (await this.request('/api/students/annual-reset', { method: 'GET' })).data || [];
    }

    async getAnnualResetBackup(operationId) {
        let cursor = null;
        let backup = null;
        do {
            const params = new URLSearchParams({ operationId });
            if (cursor) params.set('cursor', cursor);
            const page = await this.request('/api/students/annual-reset?' + params, { method: 'GET' });
            if (!backup) {
                backup = { _meta: { appName: "SIMAS - CERDAS (Reset Tahunan)", format: 'annual-reset-v2',
                    operationId, kind: page.kind, academicYear: page.academicYear,
                    backupDate: new Date(page.createdAt.replace(' ', 'T') + 'Z').toISOString(),
                    snapshotToken: page.options.snapshotToken,
                    totalRecords: 0, sources: ['d1', ...(page.kind === 'promotion' ? ['firestore'] : [])] } };
                for (const table of page.options.tables) backup[table] = { _count: 0, records: [] };
            }
            if (backup._meta.snapshotToken !== page.options.snapshotToken) throw new Error('Backup diperbarui selama pengunduhan. Silakan coba kembali.');
            for (const row of page.rows) {
                const data = JSON.parse(row.data);
                if (row.table_name === 'users') {
                    backup.users ||= { _count: 0, documents: {} };
                    backup.users.documents[row.row_key] = data;
                    backup.users._count++;
                } else {
                    backup[row.table_name] ||= { _count: 0, records: [] };
                    backup[row.table_name].records.push(data);
                    backup[row.table_name]._count++;
                }
                backup._meta.totalRecords++;
            }
            cursor = page.nextCursor;
        } while (cursor);
        return backup;
    }

    async restoreAnnualResetTable(table, records) {
        let restored = 0;
        try {
            for (let i = 0; i < records.length; i += 100) {
                const result = await this.annualResetAction('restore', { table, records: records.slice(i, i + 100) });
                restored += result.restored || 0;
            }
        } catch (error) {
            error.partialRestored = restored;
            throw error;
        }
        return restored;
    }

    async verifyStudentCredentials(nis, birthDate, nisn) {
        return await this.request('/api/students/verify-credentials', {
            method: 'POST',
            // Mengulangi verifikasi untuk UID/NIS yang sama aman: klaim ditimpa,
            // bukan membuat data baru. Kredensial salah dan pembatasan login tidak diulang.
            maxRetries: 2,
            timeoutMs: 15000,
            retryStatuses: [408, 500, 502, 503, 504],
            requireAuth: true,
            cache: 'no-store',
            body: JSON.stringify({ nis, birthDate, nisn })
        });
    }

    /**
     * Helper Eksekusi Penyimpanan Siswa: Cloudflare D1 sebagai Master Tunggal (Pure CF Write)
     */
    async dualWriteStudent(studentData, isEdit, firestoreAction) {
        if (!this.enabled) {
            throw new Error('Cloudflare D1 client tidak aktif.');
        }

        const cfResult = await this.saveStudent(studentData, isEdit);
        return {
            success: true,
            cloudflare: cfResult,
            firestore: null,
            cfError: null
        };
    }

    // ==========================================
    // 🔔 NOTIFIKASI PUSH, WHATSAPP & TELEGRAM
    // ==========================================

    async registerPushToken({ token, deviceType = 'unknown', userAgent = '' }) {
        return await this.request('/api/push/register', {
            method: 'POST',
            // Upsert berdasarkan token: aman diulang jika koneksi/D1 terputus.
            maxRetries: 2,
            body: JSON.stringify({ token, deviceType, userAgent })
        });
    }

    async sendPushNotification({ title, body, url = './dashboard.html', targetType = 'user', targetValue = '', sendTelegram = false }) {
        return await this.request('/api/push/send', {
            method: 'POST',
            body: JSON.stringify({ title, body, url, targetType, targetValue, sendTelegram })
        });
    }

    async notifyNewFeedback({ title, message, targetRecipient = 'super_admin', category = 'Umum', senderName = 'Anonim', isPublic = false }) {
        return await this.request('/api/feedback/notify', {
            method: 'POST',
            body: JSON.stringify({ title, message, targetRecipient, category, senderName, isPublic })
        });
    }

    async replyFeedback({ id, message, senderName, senderRole, status }) {
        return await this.request('/api/feedback/reply', {
            method: 'POST',
            body: JSON.stringify({ id, message, senderName, senderRole, status })
        });
    }

    async editFeedbackReply({ id, replyId, message }) {
        return await this.request('/api/feedback/reply/edit', {
            method: 'POST',
            body: JSON.stringify({ id, replyId, message })
        });
    }

    async editFeedback({ id, title, message, category }) {
        return await this.request('/api/feedback/edit', {
            method: 'POST',
            body: JSON.stringify({ id, title, message, category })
        });
    }

    async queueAgendaNotification({ eventId, title, changeType = 'updated' }) {
        return await this.request('/api/agenda/notification-queue', {
            method: 'POST',
            body: JSON.stringify({ eventId, title, changeType })
        });
    }

    async sendAttendanceReminder({ className, date }) {
        return await this.request('/api/notify/attendance-reminder', {
            method: 'POST',
            body: JSON.stringify({ className, date })
        });
    }

    async notifyJurnalVerification({ className, startDateIso, endDateIso, weekLabel, status = 'verified', verifiedByName = '', catatan = '' }) {
        return await this.request('/api/notify/jurnal-verification', {
            method: 'POST',
            body: JSON.stringify({ className, startDateIso, endDateIso, weekLabel, status, verifiedByName, catatan })
        });
    }

    async notifyConsecutiveAlpha({ className, dateStr, alphaStudents = [] }) {
        return await this.request('/api/notify/consecutive-alpha-alert', {
            method: 'POST',
            body: JSON.stringify({ className, dateStr, alphaStudents })
        });
    }

    async sendWaNotification({ phone, message, category = 'umum', targetName = '', provider = '', token = '', appKey = '', dedupeKey = '', cooldownHours = 0 }) {
        return await this.request('/api/notify/wa', {
            method: 'POST',
            body: JSON.stringify({
                phone,
                message,
                category,
                targetName,
                provider,
                token,
                appKey,
                dedupeKey,
                cooldownHours
            })
        });
    }

    async sendTelegramNotification({ chatId, message, parseMode = 'HTML', botToken = '' }) {
        return await this.request('/api/notify/telegram', {
            method: 'POST',
            body: JSON.stringify({
                chatId,
                message,
                parseMode,
                botToken
            })
        });
    }

    async verifyTelegramChatId(chatId, userName = '', botToken = '') {
        return await this.request('/api/telegram/verify', {
            method: 'POST',
            body: JSON.stringify({
                chatId,
                userName,
                botToken
            })
        });
    }

    async configureTelegramWebhook() {
        return await this.request('/api/telegram/configure-webhook', {
            method: 'POST',
            body: JSON.stringify({})
        });
    }

    async getNotificationInbox() {
        return await this.request('/api/notifications/inbox');
    }

    async markNotificationAsRead(id = '', markAll = false) {
        return await this.request('/api/notifications/mark-read', {
            method: 'POST',
            body: JSON.stringify({ id, markAll })
        });
    }

    async getHomeroomContact(studentClass = '') {
        return await this.request('/api/students/homeroom-contact', {
            method: 'POST',
            body: JSON.stringify({ class: studentClass })
        });
    }

    async searchTimeCapsuleStudents(query, year = '') {
        return await this.request('/api/timecapsule/search-students', {
            method: 'POST',
            body: JSON.stringify({ query, year })
        });
    }

    async submitTimeCapsule({ year, submission, overwrite = false, editToken = null }) {
        return await this.request('/api/timecapsule/submit', {
            method: 'POST',
            body: JSON.stringify({ year, submission, overwrite, editToken })
        });
    }

    // ==========================================
    // ⚖️ VIOLATION TYPES (Master Jenis Pelanggaran BK)
    // ==========================================

    async getViolationTypes(category = '', search = '') {
        let path = '/api/violation-types';
        const params = [];
        if (category) params.push(`category=${encodeURIComponent(category)}`);
        if (search) params.push(`search=${encodeURIComponent(search)}`);
        if (params.length > 0) path += `?${params.join('&')}`;

        const res = await this.request(path, { method: 'GET' });
        return res.data || [];
    }

    async saveViolationType(data, isEdit = false, id = null) {
        if (isEdit && id) {
            return await this.request(`/api/violation-types/${encodeURIComponent(id)}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        } else {
            return await this.request('/api/violation-types', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        }
    }

    async deleteViolationType(id) {
        return await this.request(`/api/violation-types/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    async bulkSyncViolationTypes(typesList, migrationKey = null) {
        const headers = {};
        if (migrationKey) headers['X-Migration-Key'] = migrationKey;

        return await this.request('/api/violation-types/bulk-sync', {
            method: 'POST',
            headers,
            body: JSON.stringify({ types: typesList })
        });
    }

    async migrateViolationTypes(typesList, migrationKey = null) {
        const headers = {};
        if (migrationKey) headers['X-Migration-Key'] = migrationKey;

        return await this.request('/api/migrate/violation-types', {
            method: 'POST',
            headers,
            body: JSON.stringify({ types: typesList })
        });
    }

    // ==========================================
    // 🔬 E-LABORATORIUM (Labs & Bookings)
    // ==========================================

    async getLabs() {
        const res = await this.request('/api/labs', { method: 'GET', cache: 'no-store' });
        return res.data || [];
    }

    async saveLab(labData, isEdit = false, id = null) {
        if (isEdit && id) {
            return await this.request(`/api/labs/${encodeURIComponent(id)}`, {
                method: 'PUT',
                body: JSON.stringify(labData)
            });
        } else {
            return await this.request('/api/labs', {
                method: 'POST',
                body: JSON.stringify(labData)
            });
        }
    }

    async deleteLab(id) {
        return await this.request(`/api/labs/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    async getLabBookings(filter = {}) {
        let path = '/api/lab-bookings';
        const params = [];
        if (filter.tanggal) params.push(`tanggal=${encodeURIComponent(filter.tanggal)}`);
        const start = filter.startDate || filter.weekStart;
        if (start) params.push(`weekStart=${encodeURIComponent(start)}`);
        const end = filter.endDate || filter.weekEnd;
        if (end) params.push(`weekEnd=${encodeURIComponent(end)}`);
        if (filter.labId || filter.lab_id) params.push(`lab_id=${encodeURIComponent(filter.labId || filter.lab_id)}`);
        if (filter.status) params.push(`status=${encodeURIComponent(filter.status)}`);
        if (filter.pemohonUid || filter.pemohon_uid) params.push(`pemohon_uid=${encodeURIComponent(filter.pemohonUid || filter.pemohon_uid)}`);
        if (filter.limit) params.push(`limit=${encodeURIComponent(filter.limit)}`);

        if (params.length > 0) path += `?${params.join('&')}`;

        const res = await this.request(path, { method: 'GET' });
        return res.data || [];
    }

    async saveLabBooking(bookingData, isEdit = false, id = null) {
        if (isEdit && id) {
            return await this.request(`/api/lab-bookings/${encodeURIComponent(id)}`, {
                method: 'PUT',
                body: JSON.stringify(bookingData)
            });
        } else {
            return await this.request('/api/lab-bookings', {
                method: 'POST',
                body: JSON.stringify(bookingData)
            });
        }
    }

    async updateLabBookingStatus(id, status, alasanPenolakan = '', diprosesOleh = '', autoRejectConflicts = false) {
        return await this.request(`/api/lab-bookings/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: JSON.stringify({
                status,
                alasan_penolakan: alasanPenolakan,
                diproses_oleh: diprosesOleh,
                auto_reject_conflicts: autoRejectConflicts
            })
        });
    }

    async deleteLabBooking(id) {
        return await this.request(`/api/lab-bookings/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    async migrateLabs(labsList = [], bookingsList = [], migrationKey = null) {
        const headers = {};
        if (migrationKey) headers['X-Migration-Key'] = migrationKey;

        return await this.request('/api/migrate/labs', {
            method: 'POST',
            headers,
            body: JSON.stringify({ labs: labsList, bookings: bookingsList })
        });
    }

    // ==========================================
    // 📦 E-LABORATORIUM INVENTARIS (Cloudflare D1)
    // ==========================================

    async getInventorySummary(labId = null) {
        let path = '/api/inventory/summary';
        if (labId) path += `?lab_id=${encodeURIComponent(labId)}`;
        const res = await this.request(path, { method: 'GET' });
        return res.data || { total_items: 0, total_units: 0, total_good: 0, total_minor_damage: 0, total_major_damage: 0 };
    }

    async getInventoryItems(filter = {}) {
        let path = '/api/inventory/items';
        const params = [];
        if (filter.labId || filter.lab_id) params.push(`lab_id=${encodeURIComponent(filter.labId || filter.lab_id)}`);
        if (filter.categoryId || filter.category_id) params.push(`category_id=${encodeURIComponent(filter.categoryId || filter.category_id)}`);
        if (filter.locationId || filter.location_id) params.push(`location_id=${encodeURIComponent(filter.locationId || filter.location_id)}`);
        if (filter.condition) params.push(`condition=${encodeURIComponent(filter.condition)}`);
        if (filter.search) params.push(`search=${encodeURIComponent(filter.search)}`);
        if (filter.limit) params.push(`limit=${encodeURIComponent(filter.limit)}`);
        if (filter.offset) params.push(`offset=${encodeURIComponent(filter.offset)}`);
        if (filter.sortBy || filter.sort_by) params.push(`sort_by=${encodeURIComponent(filter.sortBy || filter.sort_by)}`);
        if (filter.sortDir || filter.sort_dir) params.push(`sort_dir=${encodeURIComponent(filter.sortDir || filter.sort_dir)}`);

        if (params.length > 0) path += `?${params.join('&')}`;
        const res = await this.request(path, { method: 'GET' });
        const items = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
        if (res && typeof res.total === 'number') {
            items.total = res.total;
        }
        if (res && res.sort_by) {
            items.sort_by = res.sort_by;
            items.sort_dir = res.sort_dir;
        }
        return items;
    }

    async getInventoryItemDetail(id) {
        const res = await this.request(`/api/inventory/items/${encodeURIComponent(id)}`, { method: 'GET' });
        return res.data || null;
    }

    async saveInventoryItem(itemData, isEdit = false, id = null) {
        if (isEdit && id) {
            return await this.request(`/api/inventory/items/${encodeURIComponent(id)}`, {
                method: 'PUT',
                body: JSON.stringify(itemData)
            });
        } else {
            return await this.request('/api/inventory/items', {
                method: 'POST',
                body: JSON.stringify(itemData)
            });
        }
    }

    async bulkSaveInventoryItems(labId, items) {
        if (!Array.isArray(items) || items.length === 0) {
            throw new Error("Daftar barang inventaris tidak boleh kosong.");
        }

        // Chunking per 50 item agar selalu berada di bawah batas payload dan prepared statement limit
        const chunkSize = 50;
        let totalInserted = 0;
        const allData = [];

        for (let i = 0; i < items.length; i += chunkSize) {
            const chunk = items.slice(i, i + chunkSize);
            const res = await this.request('/api/inventory/items/bulk', {
                method: 'POST',
                body: JSON.stringify({
                    lab_id: labId,
                    items: chunk
                })
            });

            if (res && res.success) {
                totalInserted += (res.count || chunk.length);
                if (Array.isArray(res.data)) {
                    allData.push(...res.data);
                }
            } else {
                throw new Error(res?.error || `Gagal menyimpan batch barang ${i + 1}-${i + chunk.length}`);
            }
        }

        return {
            success: true,
            count: totalInserted,
            data: allData
        };
    }

    async deleteInventoryItem(id) {
        return await this.request(`/api/inventory/items/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    async changeInventoryCondition(id, payload) {
        return await this.request(`/api/inventory/items/${encodeURIComponent(id)}/change-condition`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    async getInventoryConditionHistory(id) {
        const res = await this.request(`/api/inventory/items/${encodeURIComponent(id)}/history`, { method: 'GET' });
        return res.data || [];
    }

    async getInventoryCategories(labId = null, includeInactive = false) {
        let path = '/api/inventory/categories';
        const params = [];
        if (labId) params.push(`lab_id=${encodeURIComponent(labId)}`);
        if (includeInactive) params.push('include_inactive=1');
        if (params.length > 0) path += `?${params.join('&')}`;

        const res = await this.request(path, { method: 'GET' });
        return res.data || [];
    }

    async saveInventoryCategory(categoryData, isEdit = false, id = null) {
        if (isEdit && id) {
            return await this.request(`/api/inventory/categories/${encodeURIComponent(id)}`, {
                method: 'PUT',
                body: JSON.stringify(categoryData)
            });
        } else {
            return await this.request('/api/inventory/categories', {
                method: 'POST',
                body: JSON.stringify(categoryData)
            });
        }
    }

    async deleteInventoryCategory(id) {
        return await this.request(`/api/inventory/categories/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    async getInventoryLocations(labId = null, includeInactive = false) {
        let path = '/api/inventory/locations';
        const params = [];
        if (labId) params.push(`lab_id=${encodeURIComponent(labId)}`);
        if (includeInactive) params.push('include_inactive=1');
        if (params.length > 0) path += `?${params.join('&')}`;

        const res = await this.request(path, { method: 'GET' });
        return res.data || [];
    }

    async saveInventoryLocation(locationData, isEdit = false, id = null) {
        if (isEdit && id) {
            return await this.request(`/api/inventory/locations/${encodeURIComponent(id)}`, {
                method: 'PUT',
                body: JSON.stringify(locationData)
            });
        } else {
            return await this.request('/api/inventory/locations', {
                method: 'POST',
                body: JSON.stringify(locationData)
            });
        }
    }

    async deleteInventoryLocation(id) {
        return await this.request(`/api/inventory/locations/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    // ==========================================
    // 🏛️ SARANA & PRASARANA (SARPRAS)
    // ==========================================

    async getSarprasRooms(kategori = null) {
        let path = '/api/sarpras/rooms';
        if (kategori) path += `?kategori=${encodeURIComponent(kategori)}`;
        const res = await this.request(path, { method: 'GET' });
        return res?.data || [];
    }

    async saveSarprasRoom(roomData, isEdit = false, id = null) {
        if (isEdit && id) {
            return await this.request(`/api/sarpras/rooms/${encodeURIComponent(id)}`, {
                method: 'PUT',
                body: JSON.stringify(roomData)
            });
        }
        return await this.request('/api/sarpras/rooms', {
            method: 'POST',
            body: JSON.stringify(roomData)
        });
    }

    async deleteSarprasRoom(id) {
        return await this.request(`/api/sarpras/rooms/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    async getSarprasInventorySummary(roomId = null) {
        let path = '/api/sarpras/inventory/summary';
        if (roomId) path += `?room_id=${encodeURIComponent(roomId)}`;
        const res = await this.request(path, { method: 'GET' });
        return res?.data || { total_items: 0, total_units: 0, total_good: 0, total_minor_damage: 0, total_major_damage: 0, total_estimated_value: 0 };
    }

    async getSarprasKirData(roomId) {
        return await this.request(`/api/sarpras/inventory/kir/${encodeURIComponent(roomId)}`, {
            method: 'GET'
        });
    }

    async getSarprasInventory(filter = {}) {
        let path = '/api/sarpras/inventory';
        const params = new URLSearchParams();
        if (filter.room_id) params.append('room_id', filter.room_id);
        if (filter.category_name) params.append('category_name', filter.category_name);
        if (filter.condition) params.append('condition', filter.condition);
        if (filter.search) params.append('search', filter.search);
        if (filter.sortBy) params.append('sort_by', filter.sortBy);
        if (filter.sortDir) params.append('sort_dir', filter.sortDir);
        if (filter.limit) params.append('limit', filter.limit);
        if (filter.offset !== undefined) params.append('offset', filter.offset);

        const qs = params.toString();
        if (qs) path += `?${qs}`;
        const res = await this.request(path, { method: 'GET' });
        return res || { success: true, data: [], total: 0 };
    }

    async saveSarprasInventoryItem(itemData, isEdit = false, id = null) {
        if (isEdit && id) {
            return await this.request(`/api/sarpras/inventory/${encodeURIComponent(id)}`, {
                method: 'PUT',
                body: JSON.stringify(itemData)
            });
        }
        return await this.request('/api/sarpras/inventory', {
            method: 'POST',
            body: JSON.stringify(itemData)
        });
    }

    async bulkImportSarprasInventory(roomId, items) {
        return await this.request('/api/sarpras/inventory/bulk', {
            method: 'POST',
            body: JSON.stringify({ room_id: roomId, items })
        });
    }

    async deleteSarprasInventoryItem(id) {
        return await this.request(`/api/sarpras/inventory/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    async changeSarprasInventoryCondition(id, data) {
        return await this.request(`/api/sarpras/inventory/${encodeURIComponent(id)}/change-condition`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async getSarprasInventoryHistory(id) {
        const res = await this.request(`/api/sarpras/inventory/${encodeURIComponent(id)}/history`, {
            method: 'GET'
        });
        return res?.data || [];
    }

    // --- Aduan & Usulan Warga Sarpras ---
    async getSarprasReports(filter = {}) {
        let path = '/api/sarpras/reports';
        const params = new URLSearchParams();
        if (filter.status) params.append('status', filter.status);
        if (filter.category) params.append('category', filter.category);
        if (filter.urgency) params.append('urgency', filter.urgency);
        if (filter.room_id) params.append('room_id', filter.room_id);
        if (filter.search) params.append('search', filter.search);
        if (filter.reporter_uid) params.append('reporter_uid', filter.reporter_uid);

        const qs = params.toString();
        if (qs) path += `?${qs}`;
        const res = await this.request(path, { method: 'GET' });
        return res?.data || [];
    }

    async getSarprasReportById(id) {
        return await this.request(`/api/sarpras/reports/${encodeURIComponent(id)}`, {
            method: 'GET'
        });
    }

    async saveSarprasReport(reportData, isEdit = false, id = null) {
        if (isEdit && id) {
            return await this.request(`/api/sarpras/reports/${encodeURIComponent(id)}`, {
                method: 'PUT',
                body: JSON.stringify(reportData)
            });
        }
        return await this.request('/api/sarpras/reports', {
            method: 'POST',
            body: JSON.stringify(reportData)
        });
    }

    async deleteSarprasReport(id) {
        return await this.request(`/api/sarpras/reports/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    async dispositionSarprasReport(id, dispositionData) {
        return await this.request(`/api/sarpras/reports/${encodeURIComponent(id)}/disposition`, {
            method: 'POST',
            body: JSON.stringify(dispositionData)
        });
    }

    // --- Perencanaan Anggaran RKAS Sarpras ---
    async getSarprasRkasSummary(fiscalYear = null) {
        let path = '/api/sarpras/rkas/summary';
        if (fiscalYear) path += `?fiscal_year=${encodeURIComponent(fiscalYear)}`;
        const res = await this.request(path, { method: 'GET' });
        return res?.data || {
            fiscal_year: fiscalYear || new Date().getFullYear(),
            total_items: 0,
            total_budget: 0,
            total_bos_reguler: 0,
            total_bos_kinerja: 0,
            total_komite: 0,
            total_dak: 0,
            total_lainnya: 0,
            total_p1: 0,
            total_p2: 0,
            total_p3: 0,
            total_proposed: 0,
            total_verified: 0,
            total_approved: 0,
            total_realized: 0
        };
    }

    async getSarprasRkas(filter = {}) {
        let path = '/api/sarpras/rkas';
        const params = new URLSearchParams();
        if (filter.fiscal_year) params.append('fiscal_year', filter.fiscal_year);
        if (filter.status) params.append('status', filter.status);
        if (filter.priority_scale) params.append('priority_scale', filter.priority_scale);
        if (filter.funding_source) params.append('funding_source', filter.funding_source);
        if (filter.search) params.append('search', filter.search);

        const qs = params.toString();
        if (qs) path += `?${qs}`;
        const res = await this.request(path, { method: 'GET' });
        return res?.data || [];
    }

    async saveSarprasRkasItem(itemData, isEdit = false, id = null) {
        if (isEdit && id) {
            return await this.request(`/api/sarpras/rkas/${encodeURIComponent(id)}`, {
                method: 'PUT',
                body: JSON.stringify(itemData)
            });
        }
        return await this.request('/api/sarpras/rkas', {
            method: 'POST',
            body: JSON.stringify(itemData)
        });
    }

    async deleteSarprasRkasItem(id) {
        return await this.request(`/api/sarpras/rkas/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    async approveSarprasRkasItem(id, approvalData) {
        return await this.request(`/api/sarpras/rkas/${encodeURIComponent(id)}/approve`, {
            method: 'POST',
            body: JSON.stringify(approvalData)
        });
    }

    // --- Peminjaman Sarana & Ruang (Anti-Bentrok) ---
    async checkSarprasLoanConflict(params = {}) {
        let path = '/api/sarpras/loans/check-conflict';
        const qs = new URLSearchParams(params).toString();
        if (qs) path += `?${qs}`;
        return await this.request(path, { method: 'GET' });
    }

    async getSarprasLoans(filter = {}) {
        let path = '/api/sarpras/loans';
        const params = new URLSearchParams();
        if (filter.loan_type) params.append('loan_type', filter.loan_type);
        if (filter.status) params.append('status', filter.status);
        if (filter.search) params.append('search', filter.search);
        if (filter.borrower_uid) params.append('borrower_uid', filter.borrower_uid);

        const qs = params.toString();
        if (qs) path += `?${qs}`;
        const res = await this.request(path, { method: 'GET' });
        return res?.data || [];
    }

    async saveSarprasLoan(loanData, isEdit = false, id = null) {
        if (isEdit && id) {
            return await this.request(`/api/sarpras/loans/${encodeURIComponent(id)}`, {
                method: 'PUT',
                body: JSON.stringify(loanData)
            });
        }
        return await this.request('/api/sarpras/loans', {
            method: 'POST',
            body: JSON.stringify(loanData)
        });
    }

    async deleteSarprasLoan(id) {
        return await this.request(`/api/sarpras/loans/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    async updateSarprasLoanStatus(id, statusData) {
        return await this.request(`/api/sarpras/loans/${encodeURIComponent(id)}/status`, {
            method: 'POST',
            body: JSON.stringify(statusData)
        });
    }

    // --- Barang Milik Habis Pakai (BMHP) & Mutasi Stok ---
    async getSarprasBmhpItems(filter = {}) {
        let path = '/api/sarpras/bmhp/items';
        const params = new URLSearchParams();
        if (filter.category) params.append('category', filter.category);
        if (filter.search) params.append('search', filter.search);
        if (filter.low_stock) params.append('low_stock', '1');

        const qs = params.toString();
        if (qs) path += `?${qs}`;
        const res = await this.request(path, { method: 'GET' });
        return res?.data || [];
    }

    async saveSarprasBmhpItem(itemData, isEdit = false, id = null) {
        if (isEdit && id) {
            return await this.request(`/api/sarpras/bmhp/items/${encodeURIComponent(id)}`, {
                method: 'PUT',
                body: JSON.stringify(itemData)
            });
        }
        return await this.request('/api/sarpras/bmhp/items', {
            method: 'POST',
            body: JSON.stringify(itemData)
        });
    }

    async deleteSarprasBmhpItem(id) {
        return await this.request(`/api/sarpras/bmhp/items/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    async getSarprasBmhpTransactions(filter = {}) {
        let path = '/api/sarpras/bmhp/transactions';
        const params = new URLSearchParams();
        if (filter.item_id) params.append('item_id', filter.item_id);
        if (filter.trx_type) params.append('trx_type', filter.trx_type);

        const qs = params.toString();
        if (qs) path += `?${qs}`;
        const res = await this.request(path, { method: 'GET' });
        return res?.data || [];
    }

    async recordSarprasBmhpTransaction(trxData) {
        return await this.request('/api/sarpras/bmhp/transactions', {
            method: 'POST',
            body: JSON.stringify(trxData)
        });
    }

    // --- Pemeliharaan & Tiket Servis Sarpras ---
    async getSarprasMaintenanceLogs(filter = {}) {
        let path = '/api/sarpras/maintenance/logs';
        const params = new URLSearchParams();
        if (filter.status) params.append('status', filter.status);
        if (filter.maintenance_type) params.append('maintenance_type', filter.maintenance_type);
        if (filter.priority) params.append('priority', filter.priority);
        if (filter.room_id) params.append('room_id', filter.room_id);
        if (filter.item_id) params.append('item_id', filter.item_id);
        if (filter.limit) params.append('limit', filter.limit);

        const qs = params.toString();
        if (qs) path += `?${qs}`;
        const res = await this.request(path, { method: 'GET' });
        return res?.data || [];
    }

    async getSarprasMaintenanceLogById(id) {
        const res = await this.request(`/api/sarpras/maintenance/logs/${encodeURIComponent(id)}`, {
            method: 'GET'
        });
        return res?.data || null;
    }

    async saveSarprasMaintenanceLog(logData, isEdit = false, id = null) {
        if (isEdit && id) {
            return await this.request(`/api/sarpras/maintenance/logs/${encodeURIComponent(id)}`, {
                method: 'PUT',
                body: JSON.stringify(logData)
            });
        }
        return await this.request('/api/sarpras/maintenance/logs', {
            method: 'POST',
            body: JSON.stringify(logData)
        });
    }

    async deleteSarprasMaintenanceLog(id) {
        return await this.request(`/api/sarpras/maintenance/logs/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    async getSarprasMaintenanceSchedules(filter = {}) {
        let path = '/api/sarpras/maintenance/schedules';
        const params = new URLSearchParams();
        if (filter.is_active !== undefined && filter.is_active !== null && filter.is_active !== '') {
            params.append('is_active', filter.is_active);
        }
        const qs = params.toString();
        if (qs) path += `?${qs}`;
        const res = await this.request(path, { method: 'GET' });
        return res?.data || [];
    }

    async saveSarprasMaintenanceSchedule(schedData, isEdit = false, id = null) {
        if (isEdit && id) {
            return await this.request(`/api/sarpras/maintenance/schedules/${encodeURIComponent(id)}`, {
                method: 'PUT',
                body: JSON.stringify(schedData)
            });
        }
        return await this.request('/api/sarpras/maintenance/schedules', {
            method: 'POST',
            body: JSON.stringify(schedData)
        });
    }

    async deleteSarprasMaintenanceSchedule(id) {
        return await this.request(`/api/sarpras/maintenance/schedules/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    async generateSarprasMaintenanceTicketFromSchedule(schedId) {
        return await this.request(`/api/sarpras/maintenance/schedules/${encodeURIComponent(schedId)}/generate-ticket`, {
            method: 'POST'
        });
    }

    // ==========================================
    // 🎓 E-RAPOR & JADWAL XML (SSOT CLOUDFLARE D1)
    // ==========================================

    async getRaporConfig() {
        const res = await this.request('/api/rapor/config', { method: 'GET' });
        return res.data || {};
    }

    async saveRaporConfig(config) {
        return await this.request('/api/rapor/config', {
            method: 'POST',
            body: JSON.stringify({ config })
        });
    }

    async getScheduleConfig() {
        const res = await this.request('/api/schedule/xml', { method: 'GET' });
        return res.data || null;
    }

    async saveScheduleConfig({ xmlContent, fileName = 'Jadwal.xml', teacherMapping = {} }) {
        return await this.request('/api/schedule/xml', {
            method: 'POST',
            body: JSON.stringify({ xmlContent, fileName, teacherMapping })
        });
    }

    async getRaporScores(filters = {}) {
        let path = '/api/rapor/scores';
        const params = new URLSearchParams();
        if (filters.class && filters.class !== 'all' && filters.class !== 'Semua') params.append('class', filters.class);
        if (filters.tahun_ajaran || filters.tahunAjaran) params.append('tahun_ajaran', filters.tahun_ajaran || filters.tahunAjaran);
        if (filters.nis) params.append('nis', filters.nis);

        const qs = params.toString();
        if (qs) path += `?${qs}`;

        const res = await this.request(path, { method: 'GET' });
        return res.data || [];
    }

    async saveRaporScores({ items, mapel, class: kelas, tahun_ajaran, scoreType = 'teori' }) {
        return await this.request('/api/rapor/scores', {
            method: 'POST',
            body: JSON.stringify({
                items,
                mapel,
                class: kelas,
                tahun_ajaran,
                scoreType
            })
        });
    }

    async getRaporRekap(filters = {}) {
        let path = '/api/rapor/rekap';
        const params = new URLSearchParams();
        if (filters.class && filters.class !== 'all' && filters.class !== 'Semua') params.append('class', filters.class);
        if (filters.tahun_ajaran || filters.tahunAjaran) params.append('tahun_ajaran', filters.tahun_ajaran || filters.tahunAjaran);

        const qs = params.toString();
        if (qs) path += `?${qs}`;

        const res = await this.request(path, { method: 'GET' });
        return res.data || [];
    }

    async migrateRaporData({ scores = [], config = null, schedule = null }, migrationKey = null) {
        const headers = {};
        if (migrationKey) headers['X-Migration-Key'] = migrationKey;

        return await this.request('/api/migrate/rapor', {
            method: 'POST',
            headers,
            body: JSON.stringify({ scores, config, schedule })
        });
    }

    async moveRaporScoresNIS(oldNis, newNis) {
        return await this.request('/api/rapor/move-nis', {
            method: 'POST',
            body: JSON.stringify({ old_nis: oldNis, new_nis: newNis })
        });
    }

    // ==========================================
    // 📖 JURNAL MENGAJAR GURU (SSOT CLOUDFLARE D1)
    // ==========================================

    async getJurnalMaster() {
        const res = await this.request('/api/jurnal/master', { method: 'GET' });
        return res.data || {};
    }

    async getJurnalHistory(params = {}) {
        let path = '/api/jurnal/history';
        const searchParams = new URLSearchParams();
        if (params.kelas) searchParams.append('kelas', params.kelas);
        if (params.guru) searchParams.append('guru', params.guru);
        if (params.mapel) searchParams.append('mapel', params.mapel);
        if (params.limit) searchParams.append('limit', params.limit);

        const qs = searchParams.toString();
        if (qs) path += `?${qs}`;

        const res = await this.request(path, { method: 'GET' });
        return res.data || {};
    }

    async getJurnalKbm(filters = {}) {
        let path = '/api/jurnal';
        const params = new URLSearchParams();
        if (filters.date || filters.tanggal) params.append('tanggal', filters.date || filters.tanggal);
        if (filters.startDate || filters.start_date) params.append('start_date', filters.startDate || filters.start_date);
        if (filters.endDate || filters.end_date) params.append('end_date', filters.endDate || filters.end_date);
        if (filters.kelas || filters.class) params.append('kelas', filters.kelas || filters.class);
        if (filters.guru) params.append('guru', filters.guru);
        if (filters.mapel) params.append('mapel', filters.mapel);
        if (filters.id) params.append('id', filters.id);
        if (filters.limit) params.append('limit', filters.limit);
        if (filters.offset) params.append('offset', filters.offset);
        if (filters.excludeTtd || filters.exclude_ttd) params.append('exclude_ttd', '1');

        const qs = params.toString();
        if (qs) path += `?${qs}`;

        const res = await this.request(path, { method: 'GET' });
        return res.data || [];
    }

    async saveJurnalEntry(entryData, isEdit = false, id = null) {
        if (isEdit && id) {
            return await this.request(`/api/jurnal/${encodeURIComponent(id)}`, {
                method: 'PUT',
                body: JSON.stringify(entryData)
            });
        } else {
            return await this.request('/api/jurnal', {
                method: 'POST',
                body: JSON.stringify(entryData)
            });
        }
    }

    async deleteJurnalEntry(id) {
        return await this.request(`/api/jurnal/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    async syncJurnalMaster(payload) {
        return await this.request('/api/jurnal/master/sync', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    async deleteJurnalMapel(id) {
        return await this.request(`/api/jurnal/mapel/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    async saveJurnalLokasi(lokasiData) {
        return await this.syncJurnalMaster({
            lokasis: [lokasiData]
        });
    }

    async deleteJurnalLokasi(id) {
        return await this.request(`/api/jurnal/lokasi/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    async saveJurnalSettings(settingsObj) {
        return await this.request('/api/jurnal/settings', {
            method: 'PUT',
            body: JSON.stringify(settingsObj)
        });
    }

    async deleteJurnalTeacher(id) {
        return await this.request(`/api/jurnal/teachers/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    async moveJurnalPresensiNIS(oldNis, newNis) {
        return await this.request('/api/jurnal/move-nis', {
            method: 'POST',
            body: JSON.stringify({ old_nis: oldNis, new_nis: newNis })
        });
    }

    // ==========================================
    // 👩‍🏫 MASTER DATA GTK & PTK (PURE SSOT D1)
    // ==========================================

    async getGtk(filters = {}) {
        let path = '/api/gtk';
        const params = new URLSearchParams();
        if (filters.status && filters.status !== 'all') params.append('status', filters.status);
        if (filters.search || filters.q) params.append('q', filters.search || filters.q);
        if (filters.limit) params.append('limit', String(filters.limit));
        if (filters.offset) params.append('offset', String(filters.offset));

        const qs = params.toString();
        if (qs) path += `?${qs}`;

        const res = await this.request(path, { method: 'GET' });
        return res?.data || [];
    }

    async getGtkById(id) {
        const res = await this.request(`/api/gtk/${encodeURIComponent(id)}`, {
            method: 'GET'
        });
        return res?.data || null;
    }

    async createGtk(data) {
        return await this.request('/api/gtk', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async updateGtk(id, data) {
        return await this.request(`/api/gtk/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    async deleteGtk(id) {
        return await this.request(`/api/gtk/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    async batchUpsertGtk(gtkList) {
        return await this.request('/api/gtk/batch', {
            method: 'POST',
            body: JSON.stringify({ gtk: gtkList, teachers: gtkList })
        });
    }

    // Alias compatibility untuk kode legacy
    async getTeachers(filters = {}) { return await this.getGtk(filters); }
    async getTeacher(id) { return await this.getGtkById(id); }
    async createTeacher(data) { return await this.createGtk(data); }
    async updateTeacher(id, data) { return await this.updateGtk(id, data); }
    async deleteTeacher(id) { return await this.deleteGtk(id); }
    async batchUpsertTeachers(teachersList) { return await this.batchUpsertGtk(teachersList); }

    // ------------------------------------------
    // 🔐 AUTH & USER EMAIL VERIFICATION
    // ------------------------------------------

    async setUserEmailVerified(uid, emailVerified = true) {
        return await this.request('/api/auth/verify-user-email', {
            method: 'POST',
            requireAuth: true,
            body: JSON.stringify({ uid, emailVerified })
        });
    }

    async batchVerifyUserEmails(uids) {
        return await this.request('/api/auth/batch-verify-emails', {
            method: 'POST',
            requireAuth: true,
            body: JSON.stringify({ uids })
        });
    }

    async setUserPassword(uid, password) {
        return await this.request('/api/auth/update-user-password', {
            method: 'POST',
            requireAuth: true,
            body: JSON.stringify({ uid, password })
        });
    }

    // ------------------------------------------
    // 📑 PENGAJUAN DATA GTK MANDIRI (REGISTRASI)
    // ------------------------------------------

    async submitGtkRegistration(data) {
        return await this.request('/api/gtk/submissions', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async getGtkSubmissions(status = 'pending') {
        let path = '/api/gtk/submissions';
        if (status && status !== 'all') {
            path += `?status=${encodeURIComponent(status)}`;
        }
        const res = await this.request(path, { method: 'GET' });
        return res?.data || [];
    }

    async approveGtkSubmission(id) {
        return await this.request(`/api/gtk/submissions/${encodeURIComponent(id)}/approve`, {
            method: 'POST'
        });
    }

    async rejectGtkSubmission(id, reason = '') {
        return await this.request(`/api/gtk/submissions/${encodeURIComponent(id)}/reject`, {
            method: 'POST',
            body: JSON.stringify({ reason })
        });
    }

    // ==========================================
    // 📋 AGENDA PEGAWAI (EMPLOYEE DAILY AGENDA)
    // ==========================================

    async getEmployeeAgendaTasks() {
        const res = await this.request('/api/employee-agenda/tasks', { method: 'GET' });
        return res?.data || res || { groups: [], items: [], task_items: [] };
    }

    async getEmployeeAgendaSk() {
        return await this.getEmployeeAgendaTasks();
    }

    async getMyAssignments() {
        const res = await this.request('/api/employee-agenda/assignments/my', { method: 'GET' });
        return res?.data || [];
    }

    async getEmployeeAssignments(filters = {}) {
        let path = '/api/employee-agenda/assignments';
        const params = new URLSearchParams();
        if (typeof filters === 'string') {
            params.append('gtk_id', filters);
        } else if (filters && typeof filters === 'object') {
            if (filters.gtk_id) params.append('gtk_id', filters.gtk_id);
            if (filters.sk_id) params.append('sk_id', filters.sk_id);
            if (filters.group_id) params.append('group_id', filters.group_id);
        }
        const qs = params.toString();
        if (qs) path += `?${qs}`;
        const res = await this.request(path, { method: 'GET' });
        return res?.data || [];
    }

    async getEmployeeActivities(filters = {}) {
        let path = '/api/employee-agenda/activities';
        const params = new URLSearchParams();
        if (typeof filters === 'string') {
            params.append('date', filters);
        } else if (filters && typeof filters === 'object') {
            if (filters.date) params.append('date', filters.date);
            if (filters.from) params.append('from', filters.from);
            if (filters.to) params.append('to', filters.to);
            if (filters.gtk_id) params.append('gtk_id', filters.gtk_id);
            if (filters.mode) params.append('mode', filters.mode);
            if (filters.self) params.append('self', filters.self);
        }
        const qs = params.toString();
        if (qs) path += `?${qs}`;
        const res = await this.request(path, { method: 'GET' });
        return res || { data: [], summary: {} };
    }

    async createEmployeeActivity(data) {
        return await this.request('/api/employee-agenda/activities', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async updateEmployeeActivity(id, data) {
        return await this.request(`/api/employee-agenda/activities/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    async deleteEmployeeActivity(id) {
        return await this.request(`/api/employee-agenda/activities/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    // ==========================================
    // 🏥 KETIDAKHADIRAN PEGAWAI (SAKIT/CUTI/IZIN)
    // ==========================================

    async getEmployeeAbsences(filters = {}) {
        let path = '/api/employee-agenda/absences';
        const params = new URLSearchParams();
        if (typeof filters === 'string') {
            params.append('date', filters);
        } else if (filters && typeof filters === 'object') {
            if (filters.date) params.append('date', filters.date);
            if (filters.from) params.append('from', filters.from);
            if (filters.to) params.append('to', filters.to);
            if (filters.gtk_id) params.append('gtk_id', filters.gtk_id);
            if (filters.mode) params.append('mode', filters.mode);
            if (filters.self) params.append('self', filters.self);
        }
        const qs = params.toString();
        if (qs) path += `?${qs}`;
        const res = await this.request(path, { method: 'GET' });
        return res || { success: true, data: [] };
    }

    async saveEmployeeAbsence(data) {
        return await this.request('/api/employee-agenda/absences', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async deleteEmployeeAbsence(id) {
        return await this.request(`/api/employee-agenda/absences/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    async getEmployeeAgendaSummary(filters = {}) {
        let path = '/api/employee-agenda/summary';
        const params = new URLSearchParams();
        if (typeof filters === 'string') {
            params.append('date', filters);
        } else if (filters && typeof filters === 'object') {
            if (filters.date) params.append('date', filters.date);
            if (filters.from) params.append('from', filters.from);
            if (filters.to) params.append('to', filters.to);
        }
        const qs = params.toString();
        if (qs) path += `?${qs}`;
        const res = await this.request(path, { method: 'GET' });
        return res?.data || res || {};
    }

    async getEmployeeMonthlyRecap(filters = {}) {
        let path = '/api/employee-agenda/monthly-recap';
        const params = new URLSearchParams();
        if (typeof filters === 'string') {
            params.append('month', filters);
        } else if (filters && typeof filters === 'object') {
            if (filters.month) params.append('month', filters.month);
            if (filters.year) params.append('year', filters.year);
            if (filters.gtk_id) params.append('gtk_id', filters.gtk_id);
            if (filters.mode) params.append('mode', filters.mode);
            if (filters.self) params.append('self', filters.self);
            if (filters.user_uid) params.append('user_uid', filters.user_uid);
            if (filters.employee_name) params.append('employee_name', filters.employee_name);
        }
        const qs = params.toString();
        if (qs) path += `?${qs}`;
        const res = await this.request(path, { method: 'GET' });
        return res?.data || res || {};
    }

    async manageEmployeeAgenda(actionData) {
        return await this.request('/api/employee-agenda/manage', {
            method: 'POST',
            body: JSON.stringify(actionData)
        });
    }

    async manageEmployeeSk(actionData) {
        return await this.manageEmployeeAgenda(actionData);
    }

    async getEmployeeVipSettings() {
        return await this.request('/api/employee-agenda/vip-settings', { method: 'GET' });
    }

    async saveEmployeeVipSettings(payload) {
        return await this.request('/api/employee-agenda/vip-settings', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    // ==========================================
    // 🎮 PID GAMES (PORTAL GAME EDUKATIF)
    // ==========================================

    async getPidGames(filters = {}) {
        let path = '/api/pid-games';
        const params = new URLSearchParams();
        if (filters.category && filters.category !== 'all') params.append('category', filters.category);
        if (filters.status) params.append('status', filters.status);
        if (filters.search) params.append('search', filters.search);

        const qs = params.toString();
        if (qs) path += `?${qs}`;

        const res = await this.request(path, { method: 'GET' });
        return res.data || [];
    }

    async getPidGameById(id) {
        const res = await this.request(`/api/pid-games/${encodeURIComponent(id)}`, { method: 'GET' });
        return res.data || null;
    }

    async getPidGamesConfig() {
        const res = await this.request('/api/pid-games/config', { method: 'GET' });
        return res.data || {};
    }

    async savePidGame(gameData, id = null) {
        if (id) {
            return await this.request(`/api/pid-games/${encodeURIComponent(id)}`, {
                method: 'PUT',
                body: JSON.stringify(gameData)
            });
        } else {
            return await this.request('/api/pid-games', {
                method: 'POST',
                body: JSON.stringify(gameData)
            });
        }
    }

    async deletePidGame(id) {
        return await this.request(`/api/pid-games/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    // ==========================================
    // 📋 KUESIONER PEMINATAN MAPEL SISWA
    // ==========================================

    async getPeminatanConfig() {
        const res = await this.request('/api/peminatan/config', { method: 'GET' });
        return res.data || null;
    }

    async savePeminatanConfig(configData) {
        return await this.request('/api/peminatan/config', {
            method: 'PUT',
            body: JSON.stringify(configData)
        });
    }

    async getPeminatanStatus(nis) {
        const res = await this.request(`/api/peminatan/status?nis=${encodeURIComponent(nis)}`, { method: 'GET' });
        return res || { hasSubmitted: false, isKuesionerActive: true };
    }

    async getPeminatanResponses(filters = {}) {
        let path = '/api/peminatan/responses';
        const params = new URLSearchParams();
        if (filters.year) params.append('year', filters.year);
        if (filters.class && filters.class !== 'ALL' && filters.class !== 'Semua') params.append('class', filters.class);
        if (filters.nis) params.append('nis', filters.nis);

        const qs = params.toString();
        if (qs) path += `?${qs}`;

        const res = await this.request(path, { method: 'GET' });
        return res.data || [];
    }

    async getPeminatanResponseDetail(year, nis) {
        const res = await this.request(`/api/peminatan/responses/${encodeURIComponent(year)}/${encodeURIComponent(nis)}`, { method: 'GET' });
        return res.data || null;
    }

    async submitPeminatanResponse(payload) {
        return await this.request('/api/peminatan/responses', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    async deletePeminatanResponse(year, nis) {
        return await this.request(`/api/peminatan/responses/${encodeURIComponent(year)}/${encodeURIComponent(nis)}`, {
            method: 'DELETE'
        });
    }

    async movePeminatanResponses(fromYear, toYear, nisList = []) {
        return await this.request('/api/peminatan/responses/move', {
            method: 'POST',
            body: JSON.stringify({ fromYear, toYear, nisList })
        });
    }

    async movePeminatanResponseNIS(oldNis, newNis) {
        return await this.request('/api/peminatan/responses/move-nis', {
            method: 'POST',
            body: JSON.stringify({ old_nis: oldNis, new_nis: newNis })
        });
    }

    // ==========================================
    // 📝 CATATAN KEDISIPLINAN (RECORDS: PELANGGARAN, PRESTASI, PERMISI)
    // ==========================================

    async getRecords(filters = {}) {
        let path = '/api/records';
        const params = new URLSearchParams();
        if (filters.student_nis || filters.nis || filters.studentNIS) params.append('student_nis', filters.student_nis || filters.nis || filters.studentNIS);
        if (filters.class && filters.class !== 'ALL' && filters.class !== 'Semua') params.append('class', filters.class);
        if (filters.category && filters.category !== 'ALL' && filters.category !== 'Semua') params.append('category', filters.category);
        if (filters.date_start || filters.startDate) params.append('date_start', filters.date_start || filters.startDate);
        if (filters.date_end || filters.endDate) params.append('date_end', filters.date_end || filters.endDate);
        if (filters.limit) params.append('limit', filters.limit);
        if (filters.offset) params.append('offset', filters.offset);
        if (filters.order) params.append('order', filters.order);

        const qs = params.toString();
        if (qs) path += `?${qs}`;

        const res = await this.request(path, { method: 'GET' });
        return res.data || [];
    }

    /**
     * Mengambil seluruh records dengan pagination lengkap dan pengurutan stabil.
     * Mengembalikan { data, isComplete, error, total } untuk mencegah data terpotong secara diam-diam.
     */
    async getAllRecords(filters = {}, options = {}) {
        const pageSize = Math.min(Math.max(parseInt(options.pageSize || filters.limit || 500, 10), 10), 1000);
        let offset = 0;
        let allRecords = [];
        let isComplete = false;
        let lastError = null;

        while (true) {
            try {
                const pageFilters = {
                    ...filters,
                    limit: pageSize,
                    offset,
                    order: filters.order || 'ASC'
                };
                const chunk = await this.getRecords(pageFilters);
                if (!Array.isArray(chunk)) {
                    isComplete = false;
                    break;
                }

                allRecords = allRecords.concat(chunk);
                if (chunk.length < pageSize) {
                    isComplete = true;
                    break;
                }
                offset += pageSize;

                // Safety break jika mencapai maxPages
                if (options.maxPages && (offset / pageSize) >= options.maxPages) {
                    isComplete = false;
                    break;
                }
            } catch (err) {
                console.warn(`[CloudflareClient] Gagal pagination records pada offset ${offset}:`, err);
                lastError = err;
                isComplete = false;
                break;
            }
        }

        return {
            data: allRecords,
            isComplete,
            error: lastError,
            total: allRecords.length
        };
    }

    /**
     * Mengambil agregat statistik kedisiplinan dan prestasi per rombel kelas langsung dari Cloudflare D1
     */
    async getClassRecordAggregates(filters = {}) {
        let path = '/api/records/class-aggregates';
        const params = new URLSearchParams();
        if (filters.date_start || filters.startDate) params.append('date_start', filters.date_start || filters.startDate);
        if (filters.date_end || filters.endDate) params.append('date_end', filters.date_end || filters.endDate);
        if (filters.class && filters.class !== 'ALL' && filters.class !== 'Semua') params.append('class', filters.class);

        const qs = params.toString();
        if (qs) path += `?${qs}`;

        const res = await this.request(path, { method: 'GET' });
        return res.data || {};
    }

    async getRecordStats(filters = {}) {
        let path = '/api/records/stats';
        const params = new URLSearchParams();
        if (filters.date_start || filters.startDate) params.append('date_start', filters.date_start || filters.startDate);
        if (filters.date_end || filters.endDate) params.append('date_end', filters.date_end || filters.endDate);

        const qs = params.toString();
        if (qs) path += `?${qs}`;

        const res = await this.request(path, { method: 'GET' });
        return res.data || { violation: 0, achievement: 0, permission: 0 };
    }

    async getTopViolators(limit = 5) {
        const res = await this.request(`/api/records/top-violators?limit=${limit}`, { method: 'GET' });
        return res.data || [];
    }

    async getRecordById(id) {
        const res = await this.request(`/api/records/${encodeURIComponent(id)}`, { method: 'GET' });
        return res.data || null;
    }

    async saveRecord(payload) {
        return await this.request('/api/records', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    async updateRecord(id, payload) {
        return await this.request(`/api/records/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
    }

    async deleteRecord(id) {
        return await this.request(`/api/records/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    async batchDeleteRecords(ids = []) {
        return await this.request('/api/records/batch-delete', {
            method: 'POST',
            body: JSON.stringify({ ids })
        });
    }

    async moveStudentRecordsNIS(oldNis, newNis) {
        return await this.request('/api/records/move-nis', {
            method: 'POST',
            body: JSON.stringify({ old_nis: oldNis, new_nis: newNis })
        });
    }

    // ==========================================
    // 📊 AGREGAT POIN KEDISIPLINAN SISWA
    // ==========================================

    async getStudentAggregates(nis = null) {
        let path = '/api/student-aggregates';
        if (nis) path += `?nis=${encodeURIComponent(nis)}`;
        const res = await this.request(path, { method: 'GET' });
        return res.data || (nis ? null : []);
    }

    async getStudentAggregateByNis(nis) {
        const res = await this.request(`/api/student-aggregates/${encodeURIComponent(nis)}`, { method: 'GET' });
        return res.data || { nis, id: nis, points: 0, violation_count: 0, achievement_count: 0, permission_count: 0 };
    }

    async recalculateStudentAggregates(nis = null) {
        return await this.request('/api/student-aggregates/recalculate', {
            method: 'POST',
            body: JSON.stringify({ nis })
        });
    }

    // ==========================================
    // 🤝 BIMBINGAN KONSELING (BK ACTIONS)
    // ==========================================

    async getBkActions(filters = {}) {
        let path = '/api/bk-actions';
        const params = new URLSearchParams();
        if (filters.student_nis || filters.nis || filters.studentNIS) params.append('student_nis', filters.student_nis || filters.nis || filters.studentNIS);
        if (filters.student_class || filters.class || filters.studentClass) params.append('student_class', filters.student_class || filters.class || filters.studentClass);
        if (filters.status && filters.status !== 'ALL' && filters.status !== 'Semua') params.append('status', filters.status);
        if (filters.bimbingan_type && filters.bimbingan_type !== 'ALL' && filters.bimbingan_type !== 'Semua') params.append('bimbingan_type', filters.bimbingan_type);
        if (filters.date_start || filters.startDate) params.append('date_start', filters.date_start || filters.startDate);
        if (filters.date_end || filters.endDate) params.append('date_end', filters.date_end || filters.endDate);
        if (filters.limit) params.append('limit', filters.limit);
        if (filters.offset) params.append('offset', filters.offset);

        const qs = params.toString();
        if (qs) path += `?${qs}`;

        const res = await this.request(path, { method: 'GET' });
        return res.data || [];
    }

    async getBkStats() {
        const res = await this.request('/api/bk-actions/stats', { method: 'GET' });
        return res.data || { dalam_pantauan: 0, selesai: 0, total: 0 };
    }

    async getBkStudentContext(nis) {
        const res = await this.request(`/api/bk-actions/student-context/${encodeURIComponent(nis)}`, { method: 'GET' });
        return res.data || { student: null, aggregate: { points: 0 }, violations: [], bkHistory: [] };
    }

    async getBkActionById(id) {
        const res = await this.request(`/api/bk-actions/${encodeURIComponent(id)}`, { method: 'GET' });
        return res.data || null;
    }

    async saveBkAction(payload) {
        return await this.request('/api/bk-actions', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    async updateBkAction(id, payload) {
        return await this.request(`/api/bk-actions/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
    }

    async deleteBkAction(id) {
        return await this.request(`/api/bk-actions/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    async moveBkActionsNIS(oldNis, newNis) {
        return await this.request('/api/bk-actions/move-nis', {
            method: 'POST',
            body: JSON.stringify({ old_nis: oldNis, new_nis: newNis })
        });
    }

    // ==========================================
    // 🤝 PERWALIAN GURU WALI (SSOT CLOUDFLARE D1)
    // ==========================================

    async getGuruWaliAssignments(filters = {}) {
        let path = '/api/perwalian/assignments';
        const params = new URLSearchParams();
        if (filters.guru_uid || filters.guruUid) params.append('guru_uid', filters.guru_uid || filters.guruUid);
        if (filters.student_nis || filters.studentNIS || filters.nis) params.append('student_nis', filters.student_nis || filters.studentNIS || filters.nis);
        if (filters.ta || filters.academic_year || filters.academicYear) params.append('ta', filters.ta || filters.academic_year || filters.academicYear);
        if (filters.class && filters.class !== 'all' && filters.class !== 'Semua') params.append('class', filters.class);

        const qs = params.toString();
        if (qs) path += `?${qs}`;

        const res = await this.request(path, { method: 'GET' });
        return res.data || [];
    }

    async saveGuruWaliAssignments(assignmentsList) {
        return await this.request('/api/perwalian/assignments/bulk', {
            method: 'POST',
            body: JSON.stringify({ assignments: assignmentsList })
        });
    }

    async deleteGuruWaliAssignment(id, filters = {}) {
        let path = id ? `/api/perwalian/assignments/${encodeURIComponent(id)}` : '/api/perwalian/assignments';
        const params = new URLSearchParams();
        if (filters.guru_uid) params.append('guru_uid', filters.guru_uid);
        if (filters.student_nis) params.append('student_nis', filters.student_nis);
        const qs = params.toString();
        if (qs && !id) path += `?${qs}`;

        return await this.request(path, { method: 'DELETE' });
    }

    async getGuruWaliNotes(filters = {}) {
        let path = '/api/perwalian/notes';
        const params = new URLSearchParams();
        if (filters.student_nis || filters.studentNIS || filters.nis) params.append('student_nis', filters.student_nis || filters.studentNIS || filters.nis);
        if (filters.guru_uid || filters.guruUid) params.append('guru_uid', filters.guru_uid || filters.guruUid);
        if (filters.category && filters.category !== 'all' && filters.category !== 'Semua') params.append('category', filters.category);
        if (filters.limit) params.append('limit', filters.limit);
        if (filters.offset) params.append('offset', filters.offset);

        const qs = params.toString();
        if (qs) path += `?${qs}`;

        const res = await this.request(path, { method: 'GET' });
        return res.data || [];
    }

    async saveGuruWaliNote(noteData, isEdit = false, id = null) {
        if (isEdit && id) {
            return await this.request(`/api/perwalian/notes/${encodeURIComponent(id)}`, {
                method: 'PUT',
                body: JSON.stringify(noteData)
            });
        } else {
            return await this.request('/api/perwalian/notes', {
                method: 'POST',
                body: JSON.stringify(noteData)
            });
        }
    }

    async deleteGuruWaliNote(id) {
        return await this.request(`/api/perwalian/notes/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    async movePerwalianNIS(oldNis, newNis) {
        return await this.request('/api/perwalian/move-nis', {
            method: 'POST',
            body: JSON.stringify({ old_nis: oldNis, new_nis: newNis })
        });
    }

    // ==========================================
    // 📝 CATATAN RAPOR WALI KELAS (SSOT CLOUDFLARE D1)
    // ==========================================

    async getWalikelasNotes(filters = {}) {
        let path = '/api/walikelas/notes';
        const params = new URLSearchParams();
        if (filters.class && filters.class !== 'all' && filters.class !== 'Semua') params.append('class', filters.class);
        if (filters.ta || filters.academic_year || filters.academicYear) params.append('ta', filters.ta || filters.academic_year || filters.academicYear);
        if (filters.semester) params.append('semester', filters.semester);
        if (filters.nis || filters.student_nis) params.append('nis', filters.nis || filters.student_nis);

        const qs = params.toString();
        if (qs) path += `?${qs}`;

        const res = await this.request(path, { method: 'GET' });
        return res.data || [];
    }

    async getWalikelasNoteByNis(nis, ta = '', semester = '') {
        let path = `/api/walikelas/notes/${encodeURIComponent(nis)}`;
        const params = new URLSearchParams();
        if (ta) params.append('ta', ta);
        if (semester) params.append('semester', semester);
        const qs = params.toString();
        if (qs) path += `?${qs}`;

        const res = await this.request(path, { method: 'GET' });
        return res.data || [];
    }

    async saveWalikelasNote(payload) {
        return await this.request('/api/walikelas/notes', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    async deleteWalikelasNote(id) {
        return await this.request(`/api/walikelas/notes/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    async moveWalikelasNotesNIS(oldNis, newNis) {
        return await this.request('/api/walikelas/move-nis', {
            method: 'POST',
            body: JSON.stringify({ old_nis: oldNis, new_nis: newNis })
        });
    }

    // ==========================================
    // 🚪 ALUR PERMISI SISWA 2 TAHAP (SSOT CLOUDFLARE D1)
    // ==========================================

    async getPermisiRequests(filters = {}) {
        let path = '/api/permisi';
        const params = new URLSearchParams();
        if (filters.date || filters.tanggal) params.append('date', filters.date || filters.tanggal);
        if (filters.class && filters.class !== 'all' && filters.class !== 'Semua') params.append('class', filters.class);
        if (filters.status && filters.status !== 'all' && filters.status !== 'Semua') params.append('status', filters.status);
        if (filters.student_nis || filters.nis) params.append('student_nis', filters.student_nis || filters.nis);
        if (filters.limit) params.append('limit', filters.limit);
        if (filters.offset) params.append('offset', filters.offset);

        const qs = params.toString();
        if (qs) path += `?${qs}`;

        const res = await this.request(path, { method: 'GET' });
        return res.data || [];
    }

    async submitPermisiRequest(payload) {
        return await this.request('/api/permisi', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    async processWaliPermisi(id, action = 'approve', waliName = '', note = '') {
        return await this.request(`/api/permisi/${encodeURIComponent(id)}/wali-action`, {
            method: 'PUT',
            body: JSON.stringify({ action, wali_name: waliName, note })
        });
    }

    async processPiketPermisi(id, action = 'approve', piketName = '', note = '') {
        return await this.request(`/api/permisi/${encodeURIComponent(id)}/piket-action`, {
            method: 'PUT',
            body: JSON.stringify({ action, piket_name: piketName, note })
        });
    }

    async deletePermisiRequest(id) {
        return await this.request(`/api/permisi/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
    }

    async movePermisiNIS(oldNis, newNis) {
        return await this.request('/api/permisi/move-nis', {
            method: 'POST',
            body: JSON.stringify({ old_nis: oldNis, new_nis: newNis })
        });
    }

    async migratePerwalianData({ assignments = [], notes = [] }, migrationKey = null) {
        const headers = {};
        if (migrationKey) headers['X-Migration-Key'] = migrationKey;
        return await this.request('/api/migrate/perwalian', {
            method: 'POST',
            headers,
            body: JSON.stringify({ assignments, notes })
        });
    }

    async migratePermisiData({ requests = [] }, migrationKey = null) {
        const headers = {};
        if (migrationKey) headers['X-Migration-Key'] = migrationKey;
        return await this.request('/api/migrate/permisi', {
            method: 'POST',
            headers,
            body: JSON.stringify({ requests })
        });
    }

    // ==========================================
    // ⚙️ SYSTEM SETTINGS (KEY-VALUE STORE)
    // ==========================================

    async getSystemSetting(key) {
        if (!key) throw new Error('Key pengaturan wajib disertakan.');
        const res = await this.request(`/api/settings/${encodeURIComponent(key)}`, { method: 'GET' });
        return res.data || null;
    }

    async getSystemSettings(keys = []) {
        let path = '/api/settings';
        if (Array.isArray(keys) && keys.length > 0) {
            path += `?keys=${encodeURIComponent(keys.join(','))}`;
        }
        const res = await this.request(path, { method: 'GET' });
        return res.data || {};
    }

    async saveSystemSetting(key, value) {
        if (!key) throw new Error('Key pengaturan wajib disertakan.');
        return await this.request(`/api/settings/${encodeURIComponent(key)}`, {
            method: 'POST',
            body: JSON.stringify({ key, value })
        });
    }

    async getEwsConfig() {
        const res = await this.request('/api/settings/ews-config', { method: 'GET' });
        return res.data || null;
    }

    async saveEwsConfig(config) {
        const res = await this.request('/api/settings/ews-config', {
            method: 'PUT',
            body: JSON.stringify(config)
        });
        return res.data || null;
    }

    // ==========================================
    // 🔐 WEBAUTHN / FIDO2 PASSKEY (OWASP ASVS LEVEL 2)
    // ==========================================

    async getWebAuthnRegisterOptions() {
        return await this.request('/api/auth/webauthn/register-options', {
            method: 'POST',
            body: JSON.stringify({})
        });
    }

    async verifyWebAuthnRegistration(payload) {
        return await this.request('/api/auth/webauthn/register-verify', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    async getWebAuthnLoginOptions(email = '') {
        return await this.request('/api/auth/webauthn/login-options', {
            method: 'POST',
            body: JSON.stringify({ email })
        });
    }

    async verifyWebAuthnLogin(payload) {
        return await this.request('/api/auth/webauthn/login-verify', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    async getWebAuthnStatus(email = '') {
        const path = email ? `/api/auth/webauthn/status?email=${encodeURIComponent(email)}` : '/api/auth/webauthn/status';
        return await this.request(path, { method: 'GET' });
    }

    async removeWebAuthnPasskey(credentialId = '') {
        return await this.request('/api/auth/webauthn/remove', {
            method: 'POST',
            body: JSON.stringify({ credentialId })
        });
    }

    async moveNotificationTokensNIS(oldNis, newNis) {
        return await this.request('/api/notifications/move-nis', {
            method: 'POST',
            body: JSON.stringify({ old_nis: oldNis, new_nis: newNis })
        });
    }

    // ==========================================
    // 🎓 MODUL LMS (LEARNING MANAGEMENT SYSTEM D1)
    // ==========================================

    async getLmsTopics(filters = {}) { return await cfGetLmsTopics(filters); }
    async saveLmsTopic(payload) { return await cfSaveLmsTopic(payload); }
    async deleteLmsTopic(id) { return await cfDeleteLmsTopic(id); }
    async getLmsMaterials(filters = {}) { return await cfGetLmsMaterials(filters); }
    async saveLmsMaterial(payload) { return await cfSaveLmsMaterial(payload); }
    async deleteLmsMaterial(id) { return await cfDeleteLmsMaterial(id); }
    async copyLmsFromClass(payload) { return await cfCopyLmsFromClass(payload); }
    async reorderLmsItems(payload) { return await cfReorderLmsItems(payload); }
    async getLmsMaterialProgress(materialId) { return await cfGetLmsMaterialProgress(materialId); }
    async getLmsClassAnalytics(filters = {}) { return await cfGetLmsClassAnalytics(filters); }
    async getLmsStudentCourses(filters = {}) { return await cfGetLmsStudentCourses(filters); }
    async trackLmsStudentProgress(payload, options = {}) { return await cfTrackLmsStudentProgress(payload, options); }
    async overrideLmsStudentProgress(payload) { return await cfOverrideLmsStudentProgress(payload); }
    async getLmsDiscussions(materialId) { return await cfGetLmsDiscussions(materialId); }
    async saveLmsDiscussion(payload) { return await cfSaveLmsDiscussion(payload); }
    async deleteLmsDiscussion(id) { return await cfDeleteLmsDiscussion(id); }
    async pinLmsDiscussion(id) { return await cfPinLmsDiscussion(id); }
    async updateLmsDiscussionPrompt(materialId, prompt) { return await cfUpdateLmsDiscussionPrompt(materialId, prompt); }

    // ==========================================
    // 🎓 BUKU TAHUNAN (YEARBOOK) KELAS XII & ARSIP MASTER PDF
    // ==========================================

    async getYearbookClasses() { return await cfGetYearbookClasses(); }
    async getYearbookSummary(academicYear = null) { return await cfGetYearbookSummary(academicYear); }
    async getYearbookProfile(academicYear = null) { return await cfGetYearbookProfile(academicYear); }
    async saveYearbookProfile(payload) { return await cfSaveYearbookProfile(payload); }
    async uploadYearbookCasualPhoto(payload) { return await cfUploadYearbookCasualPhoto(payload); }
    async getYearbookClass(className, academicYear = null) { return await cfGetYearbookClass(className, academicYear); }
    async sendYearbookMessage(payload) { return await cfSendYearbookMessage(payload); }
    async toggleApproveYearbookMessage(id, isApproved = null) { return await cfToggleApproveYearbookMessage(id, isApproved); }
    async deleteYearbookMessage(id) { return await cfDeleteYearbookMessage(id); }
    async getYearbookArchives() { return await cfGetYearbookArchives(); }
    async saveYearbookArchive(payload) { return await cfSaveYearbookArchive(payload); }
    async deleteYearbookArchive(academicYear) { return await cfDeleteYearbookArchive(academicYear); }
    async getYearbookAdminMessages() { return await cfGetYearbookAdminMessages(); }
    async toggleYearbookPublish(nis) { return await cfToggleYearbookPublish(nis); }

    // ==========================================
    // 🩺 HEALTH CHECK
    // ==========================================

    async checkHealth() {
        try {
            const res = await fetch(`${this.baseUrl}/api/health`);
            return await res.json();
        } catch (e) {
            return { status: 'error', error: e.message };
        }
    }
}

export const cfClient = new CloudflareClient();

function getApiUrl(endpoint) {
    const winConfig = (typeof window !== 'undefined' && window.CLOUDFLARE_CONFIG) ? window.CLOUDFLARE_CONFIG : null;
    const base = (winConfig && (winConfig.apiBaseUrl || winConfig.workerUrl))
        ? (winConfig.apiBaseUrl || winConfig.workerUrl)
        : ((typeof CLOUDFLARE_CONFIG !== 'undefined' && CLOUDFLARE_CONFIG)
            ? (CLOUDFLARE_CONFIG.apiBaseUrl || CLOUDFLARE_CONFIG.workerUrl)
            : "https://simas-demo-api.komangpurna1.workers.dev");
    return `${base.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`;
}

/**
 * Helper Request dengan Timeout, Auth Token Otomatis, Retry pada 401, & Error Handling
 */
export async function cfFetch(endpoint, options = {}, isRetry = false) {
    const url = getApiUrl(endpoint);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 detik timeout

    const headers = {
        'Accept': 'application/json',
        ...(options.headers || {}),
    };

    if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    // Pasang Firebase ID Token ke Header Authorization jika user login
    if (!headers['Authorization']) {
        if (!auth?.currentUser && auth) {
            if (typeof auth.authStateReady === 'function') {
                try {
                    await Promise.race([
                        auth.authStateReady(),
                        new Promise(resolve => setTimeout(resolve, 2000))
                    ]);
                } catch (_) {}
            } else if (typeof auth.onAuthStateChanged === 'function') {
                try {
                    await new Promise(resolve => {
                        const unsubscribe = auth.onAuthStateChanged(user => {
                            if (typeof unsubscribe === 'function') unsubscribe();
                            resolve(user);
                        });
                        setTimeout(resolve, 2000);
                    });
                } catch (_) {}
            }
        }
        if (auth?.currentUser) {
            try {
                const token = await auth.currentUser.getIdToken(isRetry);
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }
            } catch (e) {
                console.warn('[CloudflareClient] Gagal mengambil Firebase Auth token:', e);
            }
        }
    }

    // Pasang X-Student-Token kriptografis jika dalam konteks siswa (pengguna anonim, di portal siswa, atau saat token siswa tersedia)
    const isStudentContext = Boolean(
        auth?.currentUser?.isAnonymous ||
        (typeof window !== 'undefined' && window.location?.pathname?.includes('portal-siswa')) ||
        (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('student_token'))
    );
    if (isStudentContext && !headers['X-Student-Token']) {
        const studentToken = (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('student_token') : null)
            || (typeof localStorage !== 'undefined' ? localStorage.getItem('student_token') : null);
        if (studentToken) {
            headers['X-Student-Token'] = studentToken;
        }
    }

    try {
        const fetchOptions = {
            ...options,
            headers,
        };
        if (options.keepalive) {
            clearTimeout(timeoutId);
        } else {
            fetchOptions.signal = controller.signal;
        }

        const response = await fetch(url, fetchOptions);
        clearTimeout(timeoutId);

        // Auto Retry 1x jika menerima 401 Unauthorized dan ada auth user aktif
        if (response.status === 401 && !isRetry && auth?.currentUser) {
            console.warn('[CloudflareClient] Token JWT kadaluarsa (401). Memperbarui token dan mencoba ulang...');
            try {
                const freshToken = await auth.currentUser.getIdToken(true);
                if (freshToken) {
                    const retryHeaders = { ...headers, 'Authorization': `Bearer ${freshToken}` };
                    return await cfFetch(endpoint, { ...options, headers: retryHeaders }, true);
                }
            } catch (tokenErr) {
                console.warn('[CloudflareClient] Gagal refresh token saat retry:', tokenErr);
            }
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errorMessage = errorData.error || errorData.message || `HTTP Error ${response.status}: ${response.statusText}`;
            const err = new Error(errorMessage);
            err.status = response.status;
            err.data = errorData;
            if (errorData.code === 'api/write-outcome-unknown') err.code = errorData.code;
            throw err;
        }

        return await response.json();
    } catch (err) {
        clearTimeout(timeoutId);
        throw err;
    }
}

// ==============================================================================
// MODUL LMS (Learning Management System D1) - STANDALONE EXPORTS
// ==============================================================================

/**
 * Mengambil daftar topik pembelajaran dari D1
 */
export async function cfGetLmsModules(filters = {}) {
    const result = await cfFetch('/api/lms/modules?' + new URLSearchParams(Object.entries(filters).filter(([, value]) => value != null && value !== '')));
    return result.data || [];
}
export async function cfGetLmsModule(id) { return cfFetch(`/api/lms/modules/${encodeURIComponent(id)}`); }
export async function cfSaveLmsModule(payload) { return cfFetch('/api/lms/modules', { method: 'POST', body: JSON.stringify(payload) }); }
export async function cfSetLmsModuleVisibility(id, payload) { return cfFetch(`/api/lms/modules/${encodeURIComponent(id)}/settings`, { method: 'POST', body: JSON.stringify(payload) }); }
export async function cfDeleteLmsModule(id) { return cfFetch(`/api/lms/modules/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
export async function cfGetLmsModuleProgress(id) { return cfFetch(`/api/lms/modules/${encodeURIComponent(id)}/progress`); }

export async function cfGetLmsTopics(filters = {}) {
    const queryParams = new URLSearchParams();
    if (filters.class) queryParams.set('class', filters.class);
    if (filters.subject) queryParams.set('subject', filters.subject);
    if (filters.teacherId) queryParams.set('teacherId', filters.teacherId);
    if (filters.academicYear) queryParams.set('academicYear', filters.academicYear);
    if (filters.semester) queryParams.set('semester', filters.semester);

    const endpoint = `/api/lms/topics${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const response = await cfFetch(endpoint, { method: 'GET' });
    return response.data || [];
}

/**
 * Menyimpan / memperbarui topik pembelajaran di D1
 */
export async function cfSaveLmsTopic(payload) {
    return await cfFetch('/api/lms/topics', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

/**
 * Menghapus topik pembelajaran dari D1
 */
export async function cfDeleteLmsTopic(id) {
    return await cfFetch(`/api/lms/topics/${encodeURIComponent(id)}`, {
        method: 'DELETE'
    });
}

/**
 * Mengambil daftar materi pembelajaran dari D1
 */
export async function cfGetLmsMaterials(filters = {}) {
    const queryParams = new URLSearchParams();
    if (filters.topic_id) queryParams.set('topic_id', filters.topic_id);
    if (filters.class) queryParams.set('class', filters.class);
    if (filters.subject) queryParams.set('subject', filters.subject);
    if (filters.teacherId) queryParams.set('teacherId', filters.teacherId);
    if (filters.is_published !== undefined) queryParams.set('is_published', filters.is_published);

    const endpoint = `/api/lms/materials${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const response = await cfFetch(endpoint, { method: 'GET' });
    return response.data || [];
}

/**
 * Menyimpan / memperbarui materi pembelajaran di D1
 */
export async function cfSaveLmsMaterial(payload) {
    return await cfFetch('/api/lms/materials', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

/**
 * Menghapus materi pembelajaran dari D1
 */
export async function cfDeleteLmsMaterial(id) {
    return await cfFetch(`/api/lms/materials/${encodeURIComponent(id)}`, {
        method: 'DELETE'
    });
}

/**
 * Menyalin / menduplikasi topik & materi LMS dari satu kelas ke kelas lain
 */
export async function cfCopyLmsFromClass(payload) {
    return await cfFetch('/api/lms/copy-from-class', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

/**
 * Menyusun ulang urutan (reorder) topik atau modul materi pembelajaran di D1
 */
export async function cfReorderLmsItems(payload) {
    return await cfFetch('/api/lms/reorder', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

/**
 * Mengambil rekapitulasi progres siswa untuk 1 modul materi
 */
export async function cfGetLmsMaterialProgress(materialId) {
    return await cfFetch(`/api/lms/materials/${encodeURIComponent(materialId)}/progress`, {
        method: 'GET'
    });
}

/**
 * Mengambil matriks keaktifan siswa rombel (Student Engagement Analytics)
 */
export async function cfGetLmsClassAnalytics(filters = {}) {
    const queryParams = new URLSearchParams();
    if (filters.class) queryParams.set('class', filters.class);
    if (filters.subject) queryParams.set('subject', filters.subject);
    if (filters.teacherId) queryParams.set('teacherId', filters.teacherId);
    if (filters.topicId || filters.topic_id) queryParams.set('topic_id', filters.topicId || filters.topic_id);
    if (filters.materialId || filters.material_id) queryParams.set('material_id', filters.materialId || filters.material_id);

    const endpoint = `/api/lms/analytics/class${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    return await cfFetch(endpoint, { method: 'GET' });
}

/**
 * Mengambil daftar materi dan status progres untuk portal siswa
 */
export async function cfGetLmsStudentCourses(filters = {}) {
    const queryParams = new URLSearchParams();
    if (filters.class) queryParams.set('class', filters.class);
    const nis = filters.nis || filters.studentNis;
    if (nis) queryParams.set('nis', nis);

    const endpoint = `/api/lms/student/courses${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    return await cfFetch(endpoint, { method: 'GET' });
}

/**
 * Mencatat progres siswa (buka materi, sinkron durasi belajar, atau tandai selesai)
 */
export async function cfTrackLmsStudentProgress(payload, options = {}) {
    const action = String(payload?.action || payload?.status || '').toLowerCase();
    const normalizedAction = action === 'completed' ? 'complete' : action === 'opened' ? 'open' : (action === 'sync_duration' || action === 'sync') ? 'sync_duration' : action;
    if (!['open', 'complete', 'sync_duration'].includes(normalizedAction)) {
        throw new Error('Action progres LMS harus open, complete, atau sync_duration.');
    }
    return await cfFetch('/api/lms/student/track', {
        method: 'POST',
        body: JSON.stringify({ ...payload, action: normalizedAction }),
        ...options
    });
}

/**
 * Siswa: Mengirim jawaban kuis formatif untuk dinilai otomatis di server
 */
export async function cfStartLmsQuiz(payload) {
    return cfFetch('/api/lms/student/quiz/start', { method: 'POST', body: JSON.stringify(payload) });
}
export async function cfSaveLmsQuizAnswers(payload) {
    return cfFetch('/api/lms/student/quiz/save', { method: 'POST', body: JSON.stringify(payload) });
}
export async function cfGetLmsQuizAttempts(materialId, studentNis) {
    return cfFetch('/api/lms/quiz/attempts?' + new URLSearchParams({ material_id: materialId, student_nis: studentNis }));
}
export async function cfReviewLmsQuiz(payload) {
    return cfFetch('/api/lms/quiz/review', { method: 'POST', body: JSON.stringify(payload) });
}
export async function cfReportLmsQuizViolation(payload) {
    return cfFetch('/api/lms/student/quiz/violation', { method: 'POST', body: JSON.stringify(payload) });
}
export async function cfUnlockLmsQuiz(payload) {
    return cfFetch('/api/lms/quiz/unlock', { method: 'POST', body: JSON.stringify(payload) });
}
export async function cfResetLmsQuiz(payload) {
    return cfFetch('/api/lms/quiz/reset', { method: 'POST', body: JSON.stringify(payload) });
}

export async function cfSubmitLmsQuiz(payload, options = {}) {
    if (!payload?.material_id) {
        throw new Error('Material ID kuis wajib disertakan.');
    }
    return await cfFetch('/api/lms/student/quiz/submit', {
        method: 'POST',
        body: JSON.stringify(payload),
        ...options
    });
}

/**
 * Guru Mapel: Me-reset atau memverifikasi ketuntasan belajar siswa
 */
export async function cfOverrideLmsStudentProgress(payload) {
    const action = String(payload?.action || '').toLowerCase();
    if (!['reset', 'complete'].includes(action)) {
        throw new Error('Action override progres LMS harus reset atau complete.');
    }
    return await cfFetch('/api/lms/progress/override', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

/**
 * Mengambil utas diskusi bertingkat untuk modul materi
 */
export async function cfGetLmsDiscussions(materialId) {
    return await cfFetch(`/api/lms/discussions/${encodeURIComponent(materialId)}`, {
        method: 'GET'
    });
}

/**
 * Mengirim komentar atau balasan diskusi baru
 */
export async function cfSaveLmsDiscussion(payload) {
    return await cfFetch('/api/lms/discussions', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

/**
 * Menghapus komentar diskusi
 */
export async function cfDeleteLmsDiscussion(id) {
    return await cfFetch(`/api/lms/discussions/${encodeURIComponent(id)}`, {
        method: 'DELETE'
    });
}

/**
 * Menyematkan (pin) / melepas sematan komentar oleh guru
 */
export async function cfPinLmsDiscussion(id) {
    return await cfFetch(`/api/lms/discussions/${encodeURIComponent(id)}/pin`, {
        method: 'POST'
    });
}

/**
 * Memperbarui masalah / pemantik diskusi guru pada modul materi
 */
export async function cfUpdateLmsDiscussionPrompt(materialId, prompt) {
    return await cfFetch(`/api/lms/materials/${encodeURIComponent(materialId)}/prompt`, {
        method: 'POST',
        body: JSON.stringify({ discussion_prompt: prompt })
    });
}

// =========================================================================
// 🎓 STANDALONE SDK FUNCTIONS: BUKU TAHUNAN (YEARBOOK) KELAS XII & ARSIP PDF
// =========================================================================

export async function cfGetYearbookClasses() {
    const res = await cfFetch('/api/yearbook/classes');
    return res.data || [];
}

export async function cfGetYearbookSummary(academicYear = null) {
    let path = '/api/yearbook/summary';
    if (academicYear) path += `?academic_year=${encodeURIComponent(academicYear)}`;
    return await cfFetch(path);
}

export async function cfGetYearbookProfile(academicYear = null) {
    let path = '/api/yearbook/my-profile';
    if (academicYear) path += `?academic_year=${encodeURIComponent(academicYear)}`;
    return await cfFetch(path);
}

export async function cfSaveYearbookProfile(payload) {
    return await cfFetch('/api/yearbook/my-profile', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

export async function cfUploadYearbookCasualPhoto({ nis, photoBase64, image, academicYear }) {
    const imgData = photoBase64 || image;
    if (!nis || !imgData) throw new Error('NIS dan data foto WebP wajib disertakan.');
    return await cfFetch('/api/yearbook/photo/upload', {
        method: 'POST',
        body: JSON.stringify({ nis, photoBase64: imgData, image: imgData, academic_year: academicYear })
    });
}

export async function cfGetYearbookClass(className, academicYear = null) {
    if (!className) throw new Error('Nama kelas wajib disertakan.');
    let path = `/api/yearbook/class/${encodeURIComponent(className)}`;
    if (academicYear) path += `?academic_year=${encodeURIComponent(academicYear)}`;
    const res = await cfFetch(path);
    return res.data || [];
}

export async function cfSendYearbookMessage({ targetNis, message, academicYear }) {
    if (!targetNis || !message) throw new Error('Target NIS dan pesan wajib diisi.');
    return await cfFetch('/api/yearbook/messages', {
        method: 'POST',
        body: JSON.stringify({ target_nis: targetNis, message, academic_year: academicYear })
    });
}

export async function cfToggleApproveYearbookMessage(id, isApproved = null) {
    if (!id) throw new Error('ID pesan wajib disertakan.');
    const body = isApproved !== null ? { is_approved: isApproved ? 1 : 0 } : {};
    return await cfFetch(`/api/yearbook/messages/${encodeURIComponent(id)}/toggle-approval`, {
        method: 'PUT',
        body: JSON.stringify(body)
    });
}

export async function cfDeleteYearbookMessage(id) {
    if (!id) throw new Error('ID pesan wajib disertakan.');
    return await cfFetch(`/api/yearbook/messages/${encodeURIComponent(id)}`, {
        method: 'DELETE'
    });
}

export async function cfGetYearbookArchives() {
    const res = await cfFetch('/api/yearbook/archives');
    return res.data || [];
}

export async function cfSaveYearbookArchive(payload) {
    return await cfFetch('/api/yearbook/archives', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

export async function cfDeleteYearbookArchive(academicYear) {
    if (!academicYear) throw new Error('Tahun ajaran wajib disertakan.');
    return await cfFetch(`/api/yearbook/archives/${encodeURIComponent(academicYear)}`, {
        method: 'DELETE'
    });
}

export async function cfGetYearbookAdminMessages() {
    const res = await cfFetch('/api/yearbook/admin/messages');
    return res.data || [];
}

export async function cfToggleYearbookPublish(nis) {
    if (!nis) throw new Error('NIS siswa diperlukan.');
    return await cfFetch(`/api/yearbook/admin/toggle-publish/${encodeURIComponent(nis)}`, {
        method: 'PUT'
    });
}

// =========================================================================
// 📚 STANDALONE SDK FUNCTIONS: MODUL BEBAN KERJA GURU (PERMENDIKDASMEN 11/2025)
// =========================================================================

export async function cfGetWorkloadPolicy(startDate = null, endDate = null) {
    let path = '/api/workload/policy';
    if (startDate && endDate) {
        path += `?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`;
    }
    return await cfFetch(path);
}

export async function cfUpdateWorkloadPolicy(payload) {
    return await cfFetch('/api/workload/policy', {
        method: 'PUT',
        body: JSON.stringify(payload)
    });
}

export async function cfGetWorkloadCatalog(includeInactive = false) {
    let path = '/api/workload/catalog';
    if (includeInactive) path += '?include_inactive=1';
    const res = await cfFetch(path);
    return res.data || [];
}

export async function cfSaveWorkloadCatalogItem(payload) {
    return await cfFetch('/api/workload/catalog', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

export async function cfGetWorkloadAssignments(teacherId = null) {
    let path = '/api/workload/assignments';
    if (teacherId) path += `?teacher_id=${encodeURIComponent(teacherId)}`;
    const res = await cfFetch(path);
    return res.data || [];
}

export async function cfSaveWorkloadAssignment(payload) {
    return await cfFetch('/api/workload/assignments', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

export async function cfGetWakaDuties(wakaType = null, includeInactive = false) {
    let path = '/api/workload/waka-duties';
    const params = [];
    if (wakaType) params.push(`waka_type=${encodeURIComponent(wakaType)}`);
    if (includeInactive) params.push('include_inactive=1');
    if (params.length > 0) path += `?${params.join('&')}`;
    const res = await cfFetch(path);
    return res.data || [];
}

export async function cfSaveWakaDutyItem(payload) {
    return await cfFetch('/api/workload/waka-duties', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

export async function cfDeleteWakaDutyItem(id) {
    return await cfFetch('/api/workload/waka-duties', {
        method: 'POST',
        body: JSON.stringify({ action: 'delete', id })
    });
}

export async function cfGetWorkloadTemplates(teacherId = null) {
    let path = '/api/workload/templates';
    if (teacherId) path += `?teacher_id=${encodeURIComponent(teacherId)}`;
    const res = await cfFetch(path);
    return res.data || [];
}

export async function cfSaveWorkloadTemplate(payload) {
    return await cfFetch('/api/workload/templates', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

export async function cfDeleteWorkloadTemplate(templateId) {
    if (!templateId) throw new Error('ID template wajib disertakan.');
    return await cfFetch(`/api/workload/templates/${encodeURIComponent(templateId)}`, {
        method: 'DELETE'
    });
}

export async function cfInitializeWorkloadWeek(payload) {
    return await cfFetch('/api/workload/week/initialize', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

export async function cfGetWorkloadWeek(teacherId, weekStartDate, options = {}) {
    if (!weekStartDate) throw new Error('week_start_date wajib disertakan.');
    let path = `/api/workload/week?week_start_date=${encodeURIComponent(weekStartDate)}`;
    if (teacherId) path += `&teacher_id=${encodeURIComponent(teacherId)}`;
    return await cfFetch(path, options);
}

export async function cfSaveWorkloadPlanItems(payload) {
    return await cfFetch('/api/workload/plan-items', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

export async function cfDeleteWorkloadPlanItem(segmentId) {
    if (!segmentId) throw new Error('ID item rencana wajib disertakan.');
    return await cfFetch(`/api/workload/plan-items/${encodeURIComponent(segmentId)}`, {
        method: 'DELETE'
    });
}

export async function cfApplyWorkloadTemplate(payload) {
    return await cfFetch('/api/workload/apply-template', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

export async function cfDeduplicateWorkloadPlan(payload) {
    return await cfFetch('/api/workload/deduplicate-plan', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

export async function cfCleanWorkloadHolidayDrafts(payload) {
    return await cfFetch('/api/workload/clean-holiday-drafts', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

export async function cfSyncWorkloadSchedule(payload) {
    return await cfFetch('/api/workload/sync-schedule', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

export async function cfSyncWorkloadFromJournal(payload = {}) {
    return await cfFetch('/api/workload/sync-from-journal', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

export async function cfSubmitWorkloadPlan(payload) {
    return await cfFetch('/api/workload/submit-plan', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

export async function cfSaveWorkloadStudyDay(payload) {
    return await cfFetch('/api/workload/study-day', { method: 'POST', body: JSON.stringify(payload) });
}

export async function cfReopenWorkloadPlan(payload) {
    return await cfFetch('/api/workload/reopen-plan', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

export async function cfReviewWorkloadPlan(payload) {
    return await cfFetch('/api/workload/review-plan', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

export async function cfSaveWorkloadLog(payload) {
    return await cfFetch('/api/workload/logs', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

export async function cfDeleteWorkloadLog(logId) {
    if (!logId) throw new Error('ID log realisasi wajib disertakan.');
    return await cfFetch(`/api/workload/logs/${encodeURIComponent(logId)}`, {
        method: 'DELETE'
    });
}

export async function cfReviewWorkloadLogs(payload) {
    return await cfFetch('/api/workload/review-logs', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

export async function cfGetWorkloadMonitoringSummary(weekStartDate, options = {}) {
    if (!weekStartDate) throw new Error('week_start_date wajib disertakan.');
    return await cfFetch(`/api/workload/monitoring-summary?week_start_date=${encodeURIComponent(weekStartDate)}`, options);
}

export async function cfGetWorkloadExportUrl(weekStartDate, format = 'csv') {
    if (!weekStartDate) throw new Error('week_start_date wajib disertakan.');
    return `${cfClient.baseUrl}/api/workload/export?week_start_date=${encodeURIComponent(weekStartDate)}&format=${encodeURIComponent(format)}`;
}

export async function cfGetWorkloadDelegations() {
    const res = await cfFetch('/api/workload/delegations');
    return res.data || [];
}

export async function cfSaveWorkloadDelegation(payload) {
    return await cfFetch('/api/workload/delegations', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

export async function cfGetWorkloadMonthlyRecap(month, teacherId = null) {
    let path = `/api/workload/monthly-recap?month=${encodeURIComponent(month)}`;
    if (teacherId) path += `&teacher_id=${encodeURIComponent(teacherId)}`;
    return await cfFetch(path);
}

export async function cfGetEmployeeMonthlyRecap(filters = {}) {
    return await cfClient.getEmployeeMonthlyRecap(filters);
}

export async function cfGetEmployeeVipSettings() {
    return await cfClient.getEmployeeVipSettings();
}

export async function cfSaveEmployeeVipSettings(payload) {
    return await cfClient.saveEmployeeVipSettings(payload);
}

export async function cfGetKoreksiAiVipSettings() {
    return await cfFetch('/api/guru-mapel/ai-vip-settings');
}

export async function cfSaveKoreksiAiVipSettings(payload) {
    return await cfFetch('/api/guru-mapel/ai-vip-settings', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

export async function cfGetVipStatusSummary() {
    return await cfFetch('/api/vip/status-summary');
}


// =========================================================================
// AI GRADING SESSIONS (CLOUDFLARE D1 SSOT)
// =========================================================================

export async function cfSaveAiGradingSession(payload) {
    return await cfFetch('/api/ai-grading/sessions', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
}

export async function cfGetAiGradingSessions(params = {}) {
    const search = new URLSearchParams(params).toString();
    const endpoint = search ? `/api/ai-grading/sessions?${search}` : '/api/ai-grading/sessions';
    const res = await cfFetch(endpoint);
    return res.data || [];
}

export async function cfGetAiGradingSession(id) {
    if (!id) throw new Error('ID sesi wajib disertakan.');
    const res = await cfFetch(`/api/ai-grading/sessions/${encodeURIComponent(id)}`);
    return res.data || null;
}

export async function cfDeleteAiGradingSession(id) {
    if (!id) throw new Error('ID sesi wajib disertakan.');
    return await cfFetch(`/api/ai-grading/sessions/${encodeURIComponent(id)}`, {
        method: 'DELETE'
    });
}

export async function cfEditFeedbackReply(payload) {
    return await cfClient.editFeedbackReply(payload);
}

export async function cfEditFeedback(payload) {
    return await cfClient.editFeedback(payload);
}

if (typeof window !== 'undefined') {
    window.cfClient = cfClient;
    window.cfFetch = cfFetch;
    window.cfEditFeedbackReply = cfEditFeedbackReply;
    window.cfEditFeedback = cfEditFeedback;
    window.cfSaveAiGradingSession = cfSaveAiGradingSession;
    window.cfGetAiGradingSessions = cfGetAiGradingSessions;
    window.cfGetAiGradingSession = cfGetAiGradingSession;
    window.cfDeleteAiGradingSession = cfDeleteAiGradingSession;
    window.cfGetLmsTopics = cfGetLmsTopics;
    window.cfSaveLmsTopic = cfSaveLmsTopic;
    window.cfDeleteLmsTopic = cfDeleteLmsTopic;
    window.cfGetLmsMaterials = cfGetLmsMaterials;
    window.cfSaveLmsMaterial = cfSaveLmsMaterial;
    window.cfDeleteLmsMaterial = cfDeleteLmsMaterial;
    window.cfCopyLmsFromClass = cfCopyLmsFromClass;
    window.cfReorderLmsItems = cfReorderLmsItems;
    window.cfGetLmsMaterialProgress = cfGetLmsMaterialProgress;
    window.cfGetLmsClassAnalytics = cfGetLmsClassAnalytics;
    window.cfGetLmsStudentCourses = cfGetLmsStudentCourses;
    window.cfTrackLmsStudentProgress = cfTrackLmsStudentProgress;
    window.cfSubmitLmsQuiz = cfSubmitLmsQuiz;
    window.cfReportLmsQuizViolation = cfReportLmsQuizViolation;
    window.cfUnlockLmsQuiz = cfUnlockLmsQuiz;
    window.cfResetLmsQuiz = cfResetLmsQuiz;
    window.cfOverrideLmsStudentProgress = cfOverrideLmsStudentProgress;
    window.cfGetLmsDiscussions = cfGetLmsDiscussions;
    window.cfSaveLmsDiscussion = cfSaveLmsDiscussion;
    window.cfDeleteLmsDiscussion = cfDeleteLmsDiscussion;
    window.cfPinLmsDiscussion = cfPinLmsDiscussion;
    window.cfUpdateLmsDiscussionPrompt = cfUpdateLmsDiscussionPrompt;
    // Yearbook Bindings
    window.cfGetYearbookClasses = cfGetYearbookClasses;
    window.cfGetYearbookSummary = cfGetYearbookSummary;
    window.cfGetYearbookProfile = cfGetYearbookProfile;
    window.cfSaveYearbookProfile = cfSaveYearbookProfile;
    window.cfUploadYearbookCasualPhoto = cfUploadYearbookCasualPhoto;
    window.cfGetYearbookClass = cfGetYearbookClass;
    window.cfSendYearbookMessage = cfSendYearbookMessage;
    window.cfToggleApproveYearbookMessage = cfToggleApproveYearbookMessage;
    window.cfDeleteYearbookMessage = cfDeleteYearbookMessage;
    window.cfGetYearbookArchives = cfGetYearbookArchives;
    window.cfSaveYearbookArchive = cfSaveYearbookArchive;
    window.cfDeleteYearbookArchive = cfDeleteYearbookArchive;
    window.cfGetYearbookAdminMessages = cfGetYearbookAdminMessages;
    window.cfToggleYearbookPublish = cfToggleYearbookPublish;
    // Workload Guru Bindings
    window.cfGetWorkloadPolicy = cfGetWorkloadPolicy;
    window.cfUpdateWorkloadPolicy = cfUpdateWorkloadPolicy;
    window.cfGetWorkloadCatalog = cfGetWorkloadCatalog;
    window.cfSaveWorkloadCatalogItem = cfSaveWorkloadCatalogItem;
    window.cfGetWorkloadAssignments = cfGetWorkloadAssignments;
    window.cfSaveWorkloadAssignment = cfSaveWorkloadAssignment;
    window.cfGetWakaDuties = cfGetWakaDuties;
    window.cfSaveWakaDutyItem = cfSaveWakaDutyItem;
    window.cfDeleteWakaDutyItem = cfDeleteWakaDutyItem;
    window.cfGetWorkloadTemplates = cfGetWorkloadTemplates;
    window.cfSaveWorkloadTemplate = cfSaveWorkloadTemplate;
    window.cfDeleteWorkloadTemplate = cfDeleteWorkloadTemplate;
    window.cfInitializeWorkloadWeek = cfInitializeWorkloadWeek;
    window.cfGetWorkloadWeek = cfGetWorkloadWeek;
    window.cfSaveWorkloadPlanItems = cfSaveWorkloadPlanItems;
    window.cfDeleteWorkloadPlanItem = cfDeleteWorkloadPlanItem;
    window.cfApplyWorkloadTemplate = cfApplyWorkloadTemplate;
    window.cfDeduplicateWorkloadPlan = cfDeduplicateWorkloadPlan;
    window.cfCleanWorkloadHolidayDrafts = cfCleanWorkloadHolidayDrafts;
    window.cfSyncWorkloadSchedule = cfSyncWorkloadSchedule;
    window.cfSyncWorkloadFromJournal = cfSyncWorkloadFromJournal;
    window.cfSubmitWorkloadPlan = cfSubmitWorkloadPlan;
    window.cfReopenWorkloadPlan = cfReopenWorkloadPlan;
    window.cfReviewWorkloadPlan = cfReviewWorkloadPlan;
    window.cfSaveWorkloadLog = cfSaveWorkloadLog;
    window.cfDeleteWorkloadLog = cfDeleteWorkloadLog;
    window.cfReviewWorkloadLogs = cfReviewWorkloadLogs;
    window.cfGetWorkloadMonitoringSummary = cfGetWorkloadMonitoringSummary;
    window.cfGetWorkloadExportUrl = cfGetWorkloadExportUrl;
    window.cfGetWorkloadDelegations = cfGetWorkloadDelegations;
    window.cfSaveWorkloadDelegation = cfSaveWorkloadDelegation;
    window.cfGetWorkloadMonthlyRecap = cfGetWorkloadMonthlyRecap;
    window.cfGetEmployeeMonthlyRecap = cfGetEmployeeMonthlyRecap;
    window.cfGetEmployeeVipSettings = cfGetEmployeeVipSettings;
    window.cfSaveEmployeeVipSettings = cfSaveEmployeeVipSettings;
    window.cfGetKoreksiAiVipSettings = cfGetKoreksiAiVipSettings;
    window.cfSaveKoreksiAiVipSettings = cfSaveKoreksiAiVipSettings;
    window.cfGetVipStatusSummary = cfGetVipStatusSummary;
}

export default cfClient;
