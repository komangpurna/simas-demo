/* js/biometric-auth.js - SIMAS SHAKTI True WebAuthn / Passkey FIDO2 Module */
/**
 * Standar Keamanan & Kepatuhan:
 * - OWASP ASVS Level 2 & FIDO2/W3C WebAuthn Standard
 * - Zero Password Storage: Tidak ada kata sandi yang diminta atau disimpan di client-side storage (localStorage/IndexedDB)
 * - Hardware Cryptographic Bound: Kunci privat tersimpan di Secure Enclave / TPM perangkat pengguna
 * - Serverless Verification: Cloudflare Worker memverifikasi tanda tangan kriptografis dan mencetak Firebase Custom Auth Token
 */

import { auth, db, PATHS, SCHOOL_CONFIG } from "./config.js";
import { cfClient } from "./cloudflare-client.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

// =========================================================================
// UTILITAS KONVERSI BUFFER <-> BASE64URL (FIDO2 / WEBAUTHN STANDARD)
// =========================================================================

export function bufferToBase64URL(buffer) {
    if (!buffer) return '';
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

export function base64URLToBuffer(base64URL) {
    if (!base64URL) return new ArrayBuffer(0);
    let base64 = base64URL
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    while (base64.length % 4) {
        base64 += '=';
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

// =========================================================================
// PARSER COSE PUBLIC KEY -> SPKI DER (UNIVERSAL CROSS-BROWSER FALLBACK)
// =========================================================================

// Header SPKI standar ASN.1 untuk EC P-256 (ES256)
const P256_SPKI_HEADER = new Uint8Array([
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00, 0x04
]);

/**
 * Ekstraksi SPKI Public Key dari authenticator response dengan dukungan getPublicKey() dan fallback CBOR parsing
 */
export function extractPublicKeySpki(credential) {
    const response = credential.response;

    // 1. Standar WebAuthn Level 3 getPublicKey()
    if (typeof response.getPublicKey === 'function') {
        const spkiBuffer = response.getPublicKey();
        if (spkiBuffer && spkiBuffer.byteLength > 0) {
            return {
                spki: bufferToBase64URL(spkiBuffer),
                algorithm: typeof response.getPublicKeyAlgorithm === 'function' ? response.getPublicKeyAlgorithm() : -7
            };
        }
    }

    // 2. Fallback: Ekstraksi koord X & Y P-256 dari attestationObject (CBOR authData)
    if (response.attestationObject) {
        try {
            const attestationBytes = new Uint8Array(response.attestationObject);
            // Cari marker authData dan public key P-256 koordinat X (32b) dan Y (32b)
            // Dalam implementasi standar, cari byte sequence credentialId lalu ekstrak raw EC coordinates
            const rawIdBytes = new Uint8Array(credential.rawId);
            const rawIdLen = rawIdBytes.length;

            // Cari index rawId di attestationBytes
            for (let i = 0; i <= attestationBytes.length - rawIdLen; i++) {
                let match = true;
                for (let j = 0; j < rawIdLen; j++) {
                    if (attestationBytes[i + j] !== rawIdBytes[j]) {
                        match = false;
                        break;
                    }
                }
                if (match) {
                    const coseStartIndex = i + rawIdLen;
                    // Ambil 128 byte berikutnya untuk mencari koordinat X dan Y P-256
                    const coseBytes = attestationBytes.subarray(coseStartIndex);
                    // P-256 X dan Y adalah dua buffer 32 byte yang didahului header byte string (0x58, 0x20)
                    const chunks32 = [];
                    for (let c = 0; c < coseBytes.length - 34; c++) {
                        if (coseBytes[c] === 0x58 && coseBytes[c + 1] === 0x20) {
                            chunks32.push(coseBytes.subarray(c + 2, c + 34));
                            c += 33;
                            if (chunks32.length === 2) break;
                        }
                    }
                    if (chunks32.length === 2) {
                        const x = chunks32[0];
                        const y = chunks32[1];
                        const spki = new Uint8Array(P256_SPKI_HEADER.length + 64);
                        spki.set(P256_SPKI_HEADER, 0);
                        spki.set(x, P256_SPKI_HEADER.length);
                        spki.set(y, P256_SPKI_HEADER.length + 32);
                        return {
                            spki: bufferToBase64URL(spki.buffer),
                            algorithm: -7
                        };
                    }
                    break;
                }
            }
        } catch (e) {
            console.warn("[Biometric] Fallback SPKI parsing failed:", e);
        }
    }

    throw new Error("Gagal mengekstrak Public Key dari sensor biometrik perangkat ini.");
}

// =========================================================================
// 1. DETEKSI KEMAMPUAN HARDWARE SENSOR BIOMETRIK (TOUCH ID / HELLO / FACE ID)
// =========================================================================

export async function isBiometricSupported() {
    try {
        // Standar keamanan W3C mewajibkan Secure Context (HTTPS atau Localhost)
        if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
            return false;
        }
        if (!window.PublicKeyCredential) {
            return false;
        }
        if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
            const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
            return !!available;
        }
        return !!window.PublicKeyCredential;
    } catch (e) {
        console.warn("[Biometric] Deteksi perangkat biometrik:", e);
        return false;
    }
}

// =========================================================================
// 2. PENDAFTARAN PASSKEY HARDWARE BARU (100% PASSWORDLESS - GURU & STAF)
// =========================================================================

export async function registerBiometricPasskey(userEmail, userName = '') {
    if (!userEmail) throw new Error("Email pengguna diperlukan untuk pendaftaran biometrik.");

    // Hapus sisa vault password usang dari localStorage demi kepatuhan OWASP ASVS
    localStorage.removeItem('simas_passkey_vault');

    if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        const primaryDomain = window.SCHOOL_CONFIG?.primaryDomain || window.location.hostname || "simas-demo-5ead3.web.app";
        throw new Error(`Sensor biometrik (Sidik Jari / Face ID / Touch ID) memerlukan koneksi aman (HTTPS). Silakan buka melalui domain resmi https://${primaryDomain} agar sensor biometrik perangkat Anda aktif.`);
    }

    const supported = await isBiometricSupported();
    if (!supported) {
        throw new Error("Sensor biometrik tidak dapat diakses atau belum didukung pada perangkat/browser ini.");
    }

    // 1. Minta registration options & challenge dari Cloudflare Worker
    const optionsRes = await cfClient.getWebAuthnRegisterOptions();
    if (!optionsRes || !optionsRes.success || !optionsRes.challenge) {
        throw new Error(optionsRes?.error || "Gagal mendapatkan challenge pendaftaran biometrik dari server.");
    }

    const challengeBuffer = base64URLToBuffer(optionsRes.challenge);
    const userIdBuffer = new TextEncoder().encode(optionsRes.user?.id || userEmail);
    const currentRpId = optionsRes.rp?.id || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? undefined : window.location.hostname);

    const createOptions = {
        publicKey: {
            challenge: challengeBuffer,
            rp: {
                name: `${SCHOOL_CONFIG.appBrand} (${SCHOOL_CONFIG.schoolName})`,
                id: currentRpId
            },
            user: {
                id: userIdBuffer,
                name: userEmail,
                displayName: userName || userEmail
            },
            pubKeyCredParams: [
                { type: "public-key", alg: -7 },   // ES256 (ECDSA P-256)
                { type: "public-key", alg: -257 }  // RS256 (Windows Hello / Mac)
            ],
            authenticatorSelection: {
                userVerification: "preferred",
                residentKey: "preferred"
            },
            timeout: 60000,
            attestation: "none"
        }
    };

    const credential = await navigator.credentials.create(createOptions);
    if (!credential) {
        throw new Error("Pendaftaran sidik jari dibatalkan oleh pengguna.");
    }

    const credIdBase64 = bufferToBase64URL(credential.rawId);
    const { spki: publicKeySpki, algorithm } = extractPublicKeySpki(credential);
    const clientDataJSON = bufferToBase64URL(credential.response.clientDataJSON);

    // 2. Verifikasi dan simpan ke Cloudflare D1
    const verifyRes = await cfClient.verifyWebAuthnRegistration({
        credentialId: credIdBase64,
        publicKeySpki,
        algorithm,
        clientDataJSON,
        deviceName: navigator.userAgent || 'Unknown Device'
    });

    if (!verifyRes || !verifyRes.success) {
        throw new Error(verifyRes?.error || "Server menolak pendaftaran kredensial biometrik.");
    }

    // 3. Simpan metadata pendaftaran ke Firestore
    try {
        const uid = auth.currentUser?.uid;
        if (uid) {
            const userDocRef = doc(db, PATHS.users, uid);
            await updateDoc(userDocRef, {
                passkey_registered: true,
                passkey_credential_id: credIdBase64,
                passkey_device: navigator.userAgent || 'Unknown Device',
                passkey_registered_at: new Date().toISOString()
            });
        }
    } catch (dbErr) {
        console.warn("[Biometric] Catatan Firestore:", dbErr);
    }

    // 4. Simpan identitas akun yang terikat di browser ini
    localStorage.setItem('simas_passkey_bound_email', userEmail.toLowerCase().trim());
    localStorage.setItem('simas_passkey_bound_uid', auth.currentUser?.uid || '');
    localStorage.setItem('simas_passkey_cred_id', credIdBase64);
    localStorage.setItem('simas_passkey_user_name', userName || userEmail);

    const currentRole = localStorage.getItem('user_role') || 'guru_mapel';
    localStorage.setItem('simas_passkey_profile', JSON.stringify({
        email: userEmail,
        nama: userName || userEmail,
        role: currentRole
    }));

    return {
        success: true,
        credentialId: credIdBase64
    };
}

// =========================================================================
// 3. LOGIN DENGAN SIDIK JARI / PASSKEY (TRUE WEBAUTHN + CUSTOM TOKEN)
// =========================================================================

export async function authenticateBiometricPasskey(targetEmail = '') {
    // Hapus sisa vault password usang dari localStorage
    localStorage.removeItem('simas_passkey_vault');

    if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        const primaryDomain = window.SCHOOL_CONFIG?.primaryDomain || window.location.hostname || "simas-demo-5ead3.web.app";
        throw new Error(`Sensor biometrik (Sidik Jari / Face ID / Touch ID) memerlukan koneksi aman (HTTPS). Silakan buka melalui domain resmi https://${primaryDomain} agar sensor biometrik perangkat Anda aktif.`);
    }

    const supported = await isBiometricSupported();
    if (!supported) {
        throw new Error("Perangkat ini belum mendukung sensor biometrik atau sensor tidak aktif pada koneksi ini.");
    }

    const boundEmail = localStorage.getItem('simas_passkey_bound_email') || '';
    const boundCredId = localStorage.getItem('simas_passkey_cred_id') || '';
    const effectiveEmail = (targetEmail || boundEmail).toLowerCase().trim();

    // 1. Minta authentication challenge dari Cloudflare Worker
    const optionsRes = await cfClient.getWebAuthnLoginOptions(effectiveEmail);
    if (!optionsRes || !optionsRes.success || !optionsRes.challenge) {
        throw new Error(optionsRes?.error || "Gagal mendapatkan challenge login dari server.");
    }

    const challengeBuffer = base64URLToBuffer(optionsRes.challenge);
    const currentRpId = optionsRes.rpId || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? undefined : window.location.hostname);

    const getOptions = {
        publicKey: {
            challenge: challengeBuffer,
            rpId: currentRpId,
            userVerification: "preferred",
            timeout: 60000
        }
    };

    if (optionsRes.allowCredentials && Array.isArray(optionsRes.allowCredentials) && optionsRes.allowCredentials.length > 0) {
        getOptions.publicKey.allowCredentials = optionsRes.allowCredentials.map(c => ({
            type: "public-key",
            id: base64URLToBuffer(c.id),
            transports: ["internal"]
        }));
    } else if (boundCredId) {
        try {
            getOptions.publicKey.allowCredentials = [{
                type: "public-key",
                id: base64URLToBuffer(boundCredId),
                transports: ["internal"]
            }];
        } catch (_) {}
    }

    const assertion = await navigator.credentials.get(getOptions);
    if (!assertion) {
        throw new Error("Verifikasi sidik jari dibatalkan.");
    }

    const activeCredId = bufferToBase64URL(assertion.rawId);
    const clientDataJSON = bufferToBase64URL(assertion.response.clientDataJSON);
    const authenticatorData = bufferToBase64URL(assertion.response.authenticatorData);
    const signature = bufferToBase64URL(assertion.response.signature);

    // 2. Kirim tanda tangan digital ke Cloudflare Worker untuk diverifikasi di Edge
    const verifyRes = await cfClient.verifyWebAuthnLogin({
        credentialId: activeCredId,
        clientDataJSON,
        authenticatorData,
        signature,
        targetEmail: effectiveEmail
    });

    if (!verifyRes || !verifyRes.success || !verifyRes.customToken) {
        throw new Error(verifyRes?.error || "Verifikasi biometrik gagal pada server.");
    }

    // 3. Update binding lokal akun yang berhasil login
    if (verifyRes.user?.email) {
        localStorage.setItem('simas_passkey_bound_email', verifyRes.user.email);
    }
    if (verifyRes.user?.uid) {
        localStorage.setItem('simas_passkey_bound_uid', verifyRes.user.uid);
    }
    localStorage.setItem('simas_passkey_cred_id', activeCredId);

    return {
        success: true,
        customToken: verifyRes.customToken,
        user: verifyRes.user,
        email: verifyRes.user?.email || effectiveEmail
    };
}

// =========================================================================
// 4. PENGHAPUSAN KUNCI BIOMETRIK DARI PERANGKAT & SERVER
// =========================================================================

export async function removeBiometricPasskey(userEmail = '') {
    const credId = localStorage.getItem('simas_passkey_cred_id') || '';

    try {
        await cfClient.removeWebAuthnPasskey(credId);
    } catch (e) {
        console.warn("[Biometric] Hapus dari Cloudflare Worker:", e);
    }

    try {
        const uid = auth.currentUser?.uid;
        if (uid) {
            const userDocRef = doc(db, PATHS.users, uid);
            await updateDoc(userDocRef, {
                passkey_registered: false,
                passkey_credential_id: null,
                passkey_device: null,
                passkey_registered_at: null
            });
        }
    } catch (e) {
        console.warn("[Biometric] Gagal update Firestore:", e);
    }

    localStorage.removeItem('simas_passkey_bound_email');
    localStorage.removeItem('simas_passkey_bound_uid');
    localStorage.removeItem('simas_passkey_cred_id');
    localStorage.removeItem('simas_passkey_user_name');
    localStorage.removeItem('simas_passkey_profile');
    localStorage.removeItem('simas_passkey_vault');

    return { success: true };
}

// =========================================================================
// 5. PEMBERSIHAN SESI LOGOUT AMAN (PRESERVE PASSKEY HARDWARE BINDINGS)
// =========================================================================

export function clearUserSessionSafe() {
    const keysToPreserve = [
        'simas_passkey_bound_email',
        'simas_passkey_bound_uid',
        'simas_passkey_cred_id',
        'simas_passkey_user_name',
        'simas_passkey_profile',
        'dark_mode',
        'sidebar_collapsed',
        'simas_masukan_last_visited'
    ];
    const preservedData = {};
    keysToPreserve.forEach(k => {
        const val = localStorage.getItem(k);
        if (val !== null && val !== undefined) {
            preservedData[k] = val;
        }
    });

    localStorage.clear();
    sessionStorage.clear();

    // Kembalikan kredensial hardware passkey yang sah & preferensi non-sesi
    Object.keys(preservedData).forEach(k => {
        localStorage.setItem(k, preservedData[k]);
    });
}

// Inisialisasi otomatis pembersihan vault usang saat modul dimuat
if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('simas_passkey_vault');
}

if (typeof window !== 'undefined') {
    window.isBiometricSupported = isBiometricSupported;
    window.registerBiometricPasskey = registerBiometricPasskey;
    window.authenticateBiometricPasskey = authenticateBiometricPasskey;
    window.removeBiometricPasskey = removeBiometricPasskey;
    window.clearUserSessionSafe = clearUserSessionSafe;
}
