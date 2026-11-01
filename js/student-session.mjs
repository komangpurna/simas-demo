// Shared by login and the portal: a temporary refresh failure is not a logout.
const transientCodes = new Set([
    'auth/network-request-failed', 'auth/timeout', 'auth/internal-error',
    'auth/too-many-requests', 'session/claims-pending',
    'api/network-request-failed', 'api/timeout', 'api/connection-timeout', 'api/fallback-unavailable'
]);

function sessionError(code, message) {
    return Object.assign(new Error(message), { code });
}

export function isRecoverableStudentSessionError(error) {
    if (transientCodes.has(error?.code)) return true;
    if ([408, 429, 500, 502, 503, 504].includes(error?.status)) return true;
    if (error?.code) return false;
    return /failed to fetch|fetch failed|network|load failed|timed?\s*out|timeout|HTTP (408|429|502|503|504)\b/i.test(String(error?.message || ''));
}

export function isExpiredStudentSessionError(error) {
    return ['auth/user-disabled', 'auth/user-not-found', 'auth/user-token-expired',
        'auth/invalid-user-token'].includes(error?.code);
}

export async function verifyStudentSession(user, expectedNis, {
    forceRefresh = false,
    retryDelays = [600, 1200, 2400],
    isCurrent = () => true
} = {}) {
    const assertCurrent = () => {
        if (!isCurrent()) throw sessionError('session/superseded', 'Pemeriksaan sesi telah digantikan.');
    };
    assertCurrent();
    if (!user?.isAnonymous) {
        throw sessionError('session/identity-mismatch', 'Identitas sesi siswa tidak sesuai.');
    }
    const nis = String(expectedNis || '').trim();
    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
        assertCurrent();
        try {
            // Existing verified tokens can be reused; refresh only when necessary.
            const result = await user.getIdTokenResult(forceRefresh || attempt > 0);
            assertCurrent();
            const claimedNis = String(result?.claims?.studentNis || '').trim();
            if (result?.claims?.studentVerified === true && claimedNis && (!nis || claimedNis === nis)) {
                return result;
            }
            if (attempt === retryDelays.length && result?.claims?.studentVerified === true && claimedNis && nis && claimedNis !== nis) {
                throw sessionError('session/identity-mismatch', 'Identitas sesi siswa tidak sesuai.');
            }
            throw sessionError('session/claims-pending', 'Verifikasi sesi belum selesai. Silakan coba kembali.');
        } catch (error) {
            assertCurrent();
            if (!isRecoverableStudentSessionError(error) || attempt === retryDelays.length) throw error;
        }
        await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]));
    }
}
