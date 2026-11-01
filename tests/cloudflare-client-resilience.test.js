/**
 * Unit Test: CloudflareClient Resilience & Retry Logic
 * Menguji mekanisme retry eksponensial pada error transient Cloudflare D1 (Durable Object reset/timeout)
 */

describe('CloudflareClient Resilience & Error Detection', () => {
    // Definisi fungsi evaluator transient error yang sama persis dengan di CloudflareClient
    const isTransientError = (status, errorMsg) => {
        if ([408, 429, 502, 503, 504].includes(status)) {
            return true;
        }
        if (status === 500 && errorMsg) {
            return /D1_ERROR|timeout|exceeded timeout|caused object to be reset|reset|storage operation/i.test(errorMsg);
        }
        if (errorMsg) {
            return /D1_ERROR|network error|failed to fetch|timeout|exceeded timeout|caused object to be reset|network disconnected/i.test(errorMsg);
        }
        return false;
    };

    describe('isTransientError classification', () => {
        test('Mendeteksi error D1 timeout & reset sebagai transient error', () => {
            const err1 = 'Internal Server Error: D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset.';
            expect(isTransientError(500, err1)).toBe(true);

            const err2 = 'D1_ERROR: D1 DB storage operation exceeded timeout';
            expect(isTransientError(500, err2)).toBe(true);

            const err3 = 'D1 execution reset due to timeout';
            expect(isTransientError(500, err3)).toBe(true);
        });

        test('Mendeteksi HTTP status code gateway & rate limit sebagai transient error', () => {
            expect(isTransientError(502, 'Bad Gateway')).toBe(true);
            expect(isTransientError(503, 'Service Unavailable')).toBe(true);
            expect(isTransientError(504, 'Gateway Timeout')).toBe(true);
            expect(isTransientError(429, 'Too Many Requests')).toBe(true);
            expect(isTransientError(408, 'Request Timeout')).toBe(true);
        });

        test('Mendeteksi putus koneksi jaringan/fetch failure sebagai transient error', () => {
            expect(isTransientError(0, 'TypeError: Failed to fetch')).toBe(true);
            expect(isTransientError(0, 'network error occurred')).toBe(true);
        });

        test('TIDAK mengklasifikasikan error bisnis/validasi/otentikasi sebagai transient error', () => {
            expect(isTransientError(400, 'Nama laboratorium wajib diisi')).toBe(false);
            expect(isTransientError(401, 'Unauthorized: Token expired')).toBe(false);
            expect(isTransientError(403, 'Forbidden: Akses ditolak')).toBe(false);
            expect(isTransientError(404, 'Endpoint not found')).toBe(false);
            expect(isTransientError(500, 'Database constraint violation: UNIQUE constraint failed')).toBe(false);
        });
    });

    describe('Simulasi Request Auto-Retry Logic', () => {
        async function mockSimulatedRequest(mockFetch, options = {}) {
            const method = (options.method || 'GET').toUpperCase();
            const isIdempotent = ['GET', 'HEAD', 'OPTIONS'].includes(method);
            const maxRetries = options.maxRetries !== undefined
                ? options.maxRetries
                : (options.retries !== undefined ? options.retries : (isIdempotent ? 2 : 0));
            const baseDelay = options.retryDelay || 10; // Cepat untuk pengujian unit

            let lastError = null;

            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    const response = await mockFetch();

                    let json = null;
                    const responseText = await response.text();
                    try {
                        json = JSON.parse(responseText);
                    } catch (_) {}

                    if (!response.ok || (json && json.success === false)) {
                        const errorMsg = (json && json.error)
                            ? json.error
                            : (responseText && responseText.length < 200 ? responseText : `HTTP ${response.status} - Gagal memproses permintaan.`);

                        const isTransient = isTransientError(response.status, errorMsg);

                        if (isTransient && attempt < maxRetries) {
                            const delay = baseDelay * Math.pow(2, attempt);
                            await new Promise(r => setTimeout(r, delay));
                            continue;
                        }

                        throw new Error(errorMsg);
                    }

                    return json || {};
                } catch (err) {
                    lastError = err;
                    const isTransient = isTransientError(0, err.message);

                    if (isTransient && attempt < maxRetries) {
                        const delay = baseDelay * Math.pow(2, attempt);
                        await new Promise(r => setTimeout(r, delay));
                        continue;
                    }

                    throw err;
                }
            }

            throw lastError || new Error('Gagal memproses permintaan');
        }

        test('Berhasil pulih pada percobaan ke-2 setelah error D1 timeout di percobaan pertama', async () => {
            let callCount = 0;
            const mockFetch = jest.fn().mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    return {
                        ok: false,
                        status: 500,
                        text: async () => JSON.stringify({
                            success: false,
                            error: 'Internal Server Error: D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset.'
                        })
                    };
                }
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        success: true,
                        data: [{ id: 'lab_1', nama: 'Laboratorium Komputer' }]
                    })
                };
            });

            const result = await mockSimulatedRequest(mockFetch, { method: 'GET' });

            expect(mockFetch).toHaveBeenCalledTimes(2);
            expect(result.success).toBe(true);
            expect(result.data).toHaveLength(1);
            expect(result.data[0].nama).toBe('Laboratorium Komputer');
        });

        test('Berhasil pulih saat percobaan pertama gagal karena jaringan (Failed to fetch)', async () => {
            let callCount = 0;
            const mockFetch = jest.fn().mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    throw new TypeError('Failed to fetch');
                }
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        success: true,
                        data: { enabled: true }
                    })
                };
            });

            const result = await mockSimulatedRequest(mockFetch, { method: 'GET' });

            expect(mockFetch).toHaveBeenCalledTimes(2);
            expect(result.success).toBe(true);
        });

        test('Melempar error setelah kuota retry (3 attempt) habis jika D1 tetap down', async () => {
            const mockFetch = jest.fn().mockImplementation(async () => {
                return {
                    ok: false,
                    status: 500,
                    text: async () => JSON.stringify({
                        success: false,
                        error: 'Internal Server Error: D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset.'
                    })
                };
            });

            await expect(mockSimulatedRequest(mockFetch, { method: 'GET' }))
                .rejects
                .toThrow('Internal Server Error: D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset.');

            // 1 panggilan pertama + 2x retry = 3 percobaan
            expect(mockFetch).toHaveBeenCalledTimes(3);
        });

        test('TIDAK melakukan retry otomatis pada mutasi POST jika tidak diizinkan eksplisit', async () => {
            const mockFetch = jest.fn().mockImplementation(async () => {
                return {
                    ok: false,
                    status: 500,
                    text: async () => JSON.stringify({
                        success: false,
                        error: 'Internal Server Error: D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset.'
                    })
                };
            });

            await expect(mockSimulatedRequest(mockFetch, { method: 'POST' }))
                .rejects
                .toThrow('D1_ERROR');

            // Hanya dipanggil 1 kali karena POST default maxRetries = 0
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        test('Menangani respon HTML 502 Bad Gateway secara elegan tanpa JSON parse crash', async () => {
            let callCount = 0;
            const mockFetch = jest.fn().mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    return {
                        ok: false,
                        status: 502,
                        text: async () => '<html><body><center><h1>502 Bad Gateway</h1></center></body></html>'
                    };
                }
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({ success: true, message: 'OK' })
                };
            });

            const result = await mockSimulatedRequest(mockFetch, { method: 'GET' });

            expect(mockFetch).toHaveBeenCalledTimes(2);
            expect(result.success).toBe(true);
        });
    });
});
