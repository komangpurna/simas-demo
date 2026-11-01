/* js/page-integrasi.js - Standalone API Integration & Push Notification Panel */
import { auth, db, PATHS } from './config.js';
import { initLayout, showToast, escapeHTML } from './global.js';
import { cfClient } from './cloudflare-client.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { 
    doc, 
    setDoc, 
    getDoc, 
    getDocs, 
    collection, 
    serverTimestamp, 
    query, 
    where, 
    orderBy 
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

// --- HELPER: MODERN ALERT ---
function showModernAlert(title, message, type = 'success') {
    const modal = document.getElementById('modal-alert');
    if (!modal) { showToast(title, message, type === 'success' ? 'success' : 'error'); return; }

    const iconContainer = document.getElementById('alert-icon-container');
    const icon = document.getElementById('alert-icon');
    const titleEl = document.getElementById('alert-title');
    const msgEl = document.getElementById('alert-msg');

    if (type === 'success') {
        iconContainer.className = "w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4 text-green-600 dark:text-green-400";
        icon.className = "fa-solid fa-check text-3xl";
    } else {
        iconContainer.className = "w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4 text-red-600 dark:text-red-400";
        icon.className = "fa-solid fa-triangle-exclamation text-3xl";
    }

    titleEl.innerText = title;
    msgEl.innerHTML = message;
    modal.classList.remove('hidden');
}

// Check authorization and load page configs
onAuthStateChanged(auth, async (user) => {
    if (!user) return; // Handle redirect in global router or auto redirect

    const isSuperAdmin = window.hasRole ? window.hasRole('super_admin') : localStorage.getItem('user_role') === 'super_admin';
    if (!isSuperAdmin) {
        await window.showAlertModal("Akses Ditolak", "Anda tidak memiliki wewenang untuk membuka halaman ini.", "error");
        window.location.href = "dashboard.html";
        return;
    }

    // Initialize layout shell
    await initLayout('super_admin');
    
    // Display main content
    document.querySelector('main').classList.remove('hidden');

    // Load configurations
    loadWaConfig();
    loadPushConfig();
    initPushTesterPanel();
    window.setupPushUserCombobox();
});

// =============================================
// =============================================
// SECTION: WHATSAPP INTEGRATION & TELEGRAM ALERT
// =============================================

window.handleWaProviderChange = (type, isInitialLoad = false) => {
    const select = document.getElementById(`select-wa-${type}-provider`);
    const containerAppKey = document.getElementById(`container-wa-${type}-appkey`);
    const labelToken = document.getElementById(`label-wa-${type}-token`);
    const inputToken = document.getElementById(type === 'primary' ? 'input-wa-token' : (type === 'fallback' ? 'input-wa-fallback-token' : 'input-wa-fallback2-token'));
    const inputAppKey = document.getElementById(`input-wa-${type}-appkey`);
    if (!select) return;

    const val = select.value;
    const loadedData = window._loadedWaConfig || {};
    const defaultProvider = type === 'primary' ? 'fonnte' : (type === 'fallback' ? 'wapanels' : 'fonnte');
    const savedProvider = loadedData[`${type}Provider`] || defaultProvider;

    // Jika user mengubah provider secara manual (bukan initial load), sesuaikan token & appkey
    if (!isInitialLoad) {
        if (val === savedProvider) {
            // Restore token & appKey yang tersimpan untuk provider ini
            if (inputToken) {
                if (val === 'wapanels') {
                    inputToken.value = loadedData[`${type}Token`] || '';
                } else {
                    inputToken.value = loadedData[`${type}Token`] || (type === 'primary' ? loadedData.fonnteToken : '') || '';
                }
            }
            if (inputAppKey) {
                inputAppKey.value = loadedData[`${type}AppKey`] || '';
            }
        } else {
            // Jika memilih provider lain yang belum disimpan, kosongkan agar tidak menyalin token provider lama
            if (inputToken) inputToken.value = '';
            if (inputAppKey) inputAppKey.value = '';
        }
    }

    if (val === 'wapanels') {
        if (containerAppKey) containerAppKey.classList.remove('hidden');
        if (labelToken) labelToken.innerText = `Auth Key (Watsap.id / Wapanels)`;
        if (inputToken) inputToken.placeholder = `Masukkan Auth Key Watsap.id`;
    } else {
        // Fonnte (Default)
        if (containerAppKey) containerAppKey.classList.add('hidden');
        if (labelToken) labelToken.innerText = `API Token (Fonnte)`;
        if (inputToken) inputToken.placeholder = `Masukkan Token Fonnte`;
    }
};

window.renderProviderMatrix = (data) => {
    const tbody = document.getElementById('tbody-provider-matrix');
    if (!tbody) return;

    if (!data) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-slate-400">Belum ada konfigurasi gateway tersimpan.</td></tr>`;
        return;
    }

    const rows = [
        {
            key: 'primary',
            level: 'Primary Gateway',
            badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
            provider: data.primaryProvider === 'wapanels' ? 'WATSAP.ID (WAPANELS)' : 'FONNTE',
            accountName: data.primaryAccountName || '',
            appKey: data.primaryProvider === 'wapanels' ? (data.primaryAppKey || '-') : '-',
            token: data.primaryToken || data.fonnteToken || '',
            enabled: data.enabled || false
        },
        {
            key: 'fallback',
            level: 'Backup 1 Gateway',
            badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
            provider: data.fallbackProvider === 'wapanels' ? 'WATSAP.ID (WAPANELS)' : 'FONNTE',
            accountName: data.fallbackAccountName || '',
            appKey: data.fallbackProvider === 'wapanels' ? (data.fallbackAppKey || '-') : '-',
            token: data.fallbackToken || '',
            enabled: data.fallbackEnabled || false
        },
        {
            key: 'fallback2',
            level: 'Backup 2 Gateway',
            badgeClass: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
            provider: data.fallback2Provider === 'wapanels' ? 'WATSAP.ID (WAPANELS)' : 'FONNTE',
            accountName: data.fallback2AccountName || '',
            appKey: data.fallback2Provider === 'wapanels' ? (data.fallback2AppKey || '-') : '-',
            token: data.fallback2Token || '',
            enabled: data.fallback2Enabled || false
        },
        {
            key: 'telegram',
            level: 'Telegram Alert',
            badgeClass: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
            provider: "TELEGRAM BOT (@simas_demo_bot)",
            accountName: '',
            appKey: `Chat ID: ${data.telegramAdminChatId || '198160734'}`,
            token: '',
            isWorkerSecret: true,
            enabled: data.telegramEnabled === true || String(data.telegramEnabled) === 'true'
        }
    ];

    tbody.innerHTML = rows.map((r, idx) => {
        const maskedToken = r.token ? '••••••••••••••••' : '<span class="text-slate-400 italic">Belum diatur</span>';
        const hasToken = !!r.token;

        let tokenCellHtml = `<span class="text-slate-400 italic">Belum diset</span>`;
        if (r.isWorkerSecret) {
            tokenCellHtml = `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800/60"><i class="fa-solid fa-shield-halved text-[9px]"></i> Worker Secret</span>`;
        } else if (hasToken) {
            tokenCellHtml = `
                <div class="flex items-center gap-2">
                    <span id="matrix-token-text-${idx}" class="text-slate-700 dark:text-slate-300 font-mono">${maskedToken}</span>
                    <button type="button" onclick="window.toggleMatrixTokenVisibility('${idx}', '${encodeURIComponent(r.token)}')" class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs px-1" title="Lihat Key Tersimpan">
                        <i id="matrix-token-icon-${idx}" class="fa-solid fa-eye"></i>
                    </button>
                </div>
            `;
        }

        return `
            <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition-colors">
                <td class="py-3 px-4 font-semibold">
                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold ${r.badgeClass}">
                        ${r.level}
                    </span>
                </td>
                <td class="py-3 px-4 font-bold text-slate-800 dark:text-white">
                    ${r.provider}
                    ${r.accountName ? `<div class="text-[11px] font-normal text-slate-500 dark:text-slate-400 mt-0.5"><i class="fa-regular fa-id-card mr-1 text-[10px]"></i>${r.accountName}</div>` : ''}
                </td>
                <td class="py-3 px-4 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                    ${r.appKey}
                </td>
                <td class="py-3 px-4 font-mono text-[11px]">
                    ${tokenCellHtml}
                </td>
                <td class="py-3 px-4">
                    ${r.enabled ? 
                        `<span class="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400"><i class="fa-solid fa-circle text-[8px]"></i> Aktif</span>` : 
                        `<span class="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400"><i class="fa-solid fa-circle text-[8px]"></i> Nonaktif</span>`}
                </td>
            </tr>
        `;
    }).join('');
};

window.toggleMatrixTokenVisibility = (idx, rawTokenEncoded) => {
    const textEl = document.getElementById(`matrix-token-text-${idx}`);
    const iconEl = document.getElementById(`matrix-token-icon-${idx}`);
    if (!textEl || !iconEl) return;

    const rawToken = decodeURIComponent(rawTokenEncoded);
    if (iconEl.classList.contains('fa-eye')) {
        textEl.innerText = rawToken;
        iconEl.className = 'fa-solid fa-eye-slash';
    } else {
        textEl.innerText = '••••••••••••••••';
        iconEl.className = 'fa-solid fa-eye';
    }
};

async function loadWaConfig() {
    try {
        const snap = await getDoc(doc(db, PATHS.settings, 'wa_config'));
        if (snap.exists()) {
            const rawData = snap.data();
            // Secret lama tidak pernah ditampilkan kembali ke browser. Nilai ini
            // dikelola sebagai encrypted Worker secrets di Cloudflare.
            const data = {
                ...rawData,
                primaryAppKey: '', primaryToken: '', fonnteToken: '',
                fallbackAppKey: '', fallbackToken: '',
                fallback2AppKey: '', fallback2Token: '', telegramBotToken: ''
            };
            window._loadedWaConfig = data;
            
            // 1. Primary WA Gateway
            const toggleWa = document.getElementById('toggle-wa-enabled');
            if (toggleWa) {
                toggleWa.checked = data.enabled || false;
                const statusElem = document.getElementById('status-wa');
                if (statusElem) statusElem.innerText = data.enabled ? 'Aktif' : 'Nonaktif';
                toggleWa.addEventListener('change', (e) => {
                    if (statusElem) statusElem.innerText = e.target.checked ? 'Aktif' : 'Nonaktif';
                });
            }

            const inputPrimaryAccountName = document.getElementById('input-wa-primary-account-name');
            if (inputPrimaryAccountName) {
                inputPrimaryAccountName.value = data.primaryAccountName || '';
            }

            const savedPrimaryProvider = data.primaryProvider || 'fonnte';
            const selectPrimaryProvider = document.getElementById('select-wa-primary-provider');
            if (selectPrimaryProvider) {
                selectPrimaryProvider.value = savedPrimaryProvider;
            }

            const inputPrimaryAppKey = document.getElementById('input-wa-primary-appkey');
            if (inputPrimaryAppKey) {
                inputPrimaryAppKey.value = savedPrimaryProvider === 'wapanels' ? (data.primaryAppKey || '') : '';
            }

            const inputPrimaryToken = document.getElementById('input-wa-token');
            if (inputPrimaryToken) {
                if (savedPrimaryProvider === 'wapanels') {
                    inputPrimaryToken.value = data.primaryToken || '';
                } else {
                    inputPrimaryToken.value = data.primaryToken || data.fonnteToken || '';
                }
            }

            window.handleWaProviderChange('primary', true);

            // 2. Fallback / Backup 1 WA Gateway
            const toggleFallback = document.getElementById('toggle-wa-fallback-enabled');
            if (toggleFallback) {
                toggleFallback.checked = data.fallbackEnabled || false;
                const statusFallbackElem = document.getElementById('status-wa-fallback');
                if (statusFallbackElem) statusFallbackElem.innerText = data.fallbackEnabled ? 'Aktif' : 'Nonaktif';
                toggleFallback.addEventListener('change', (e) => {
                    if (statusFallbackElem) statusFallbackElem.innerText = e.target.checked ? 'Aktif' : 'Nonaktif';
                });
            }

            const inputFallbackAccountName = document.getElementById('input-wa-fallback-account-name');
            if (inputFallbackAccountName) {
                inputFallbackAccountName.value = data.fallbackAccountName || '';
            }

            const savedFallbackProvider = data.fallbackProvider || 'wapanels';
            const selectFallbackProvider = document.getElementById('select-wa-fallback-provider');
            if (selectFallbackProvider) {
                selectFallbackProvider.value = savedFallbackProvider;
            }

            const inputFallbackAppKey = document.getElementById('input-wa-fallback-appkey');
            if (inputFallbackAppKey) {
                inputFallbackAppKey.value = savedFallbackProvider === 'wapanels' ? (data.fallbackAppKey || '') : '';
            }

            const inputFallbackToken = document.getElementById('input-wa-fallback-token');
            if (inputFallbackToken) {
                inputFallbackToken.value = data.fallbackToken || '';
            }

            window.handleWaProviderChange('fallback', true);

            // 3. Fallback 2 / Backup 2 WA Gateway
            const toggleFallback2 = document.getElementById('toggle-wa-fallback2-enabled');
            if (toggleFallback2) {
                toggleFallback2.checked = data.fallback2Enabled || false;
                const statusFallback2Elem = document.getElementById('status-wa-fallback2');
                if (statusFallback2Elem) statusFallback2Elem.innerText = data.fallback2Enabled ? 'Aktif' : 'Nonaktif';
                toggleFallback2.addEventListener('change', (e) => {
                    if (statusFallback2Elem) statusFallback2Elem.innerText = e.target.checked ? 'Aktif' : 'Nonaktif';
                });
            }

            const inputFallback2AccountName = document.getElementById('input-wa-fallback2-account-name');
            if (inputFallback2AccountName) {
                inputFallback2AccountName.value = data.fallback2AccountName || '';
            }

            const savedFallback2Provider = data.fallback2Provider || 'fonnte';
            const selectFallback2Provider = document.getElementById('select-wa-fallback2-provider');
            if (selectFallback2Provider) {
                selectFallback2Provider.value = savedFallback2Provider;
            }

            const inputFallback2AppKey = document.getElementById('input-wa-fallback2-appkey');
            if (inputFallback2AppKey) {
                inputFallback2AppKey.value = savedFallback2Provider === 'wapanels' ? (data.fallback2AppKey || '') : '';
            }

            const inputFallback2Token = document.getElementById('input-wa-fallback2-token');
            if (inputFallback2Token) {
                inputFallback2Token.value = data.fallback2Token || '';
            }

            window.handleWaProviderChange('fallback2', true);

            // 4. Telegram Super Admin Alert
            const toggleTelegram = document.getElementById('toggle-telegram-enabled');
            if (toggleTelegram) {
                const isTelegramActive = data.telegramEnabled === true || String(data.telegramEnabled) === 'true';
                toggleTelegram.checked = isTelegramActive;
                const statusTgElem = document.getElementById('status-telegram');
                if (statusTgElem) statusTgElem.innerText = isTelegramActive ? 'Aktif' : 'Nonaktif';
                toggleTelegram.addEventListener('change', (e) => {
                    if (statusTgElem) statusTgElem.innerText = e.target.checked ? 'Aktif' : 'Nonaktif';
                });
            }

            const inputTelegramChatId = document.getElementById('input-telegram-admin-chatid');
            if (inputTelegramChatId) {
                inputTelegramChatId.value = data.telegramAdminChatId || '198160734';
            }

            // Render Ringkasan Matrix Provider Tersimpan
            window.renderProviderMatrix(data);

        } else {
            const toggleWa = document.getElementById('toggle-wa-enabled');
            if (toggleWa) {
                toggleWa.checked = false;
                const statusElem = document.getElementById('status-wa');
                if (statusElem) statusElem.innerText = 'Nonaktif';
            }
            window.renderProviderMatrix(null);
        }
    } catch (e) {
        console.error("[Settings] Gagal memuat konfigurasi WA Multi-Provider:", e);
    }
}

window.toggleWaTokenVisibility = (inputId, iconId) => {
    const inputToken = document.getElementById(inputId || 'input-wa-token');
    const iconVisibility = document.getElementById(iconId || 'icon-primary-token-visibility');
    if (!inputToken || !iconVisibility) return;
    
    if (inputToken.type === 'password') {
        inputToken.type = 'text';
        iconVisibility.className = 'fa-solid fa-eye-slash text-sm';
    } else {
        inputToken.type = 'password';
        iconVisibility.className = 'fa-solid fa-eye text-sm';
    }
};

window.saveWaConfig = async () => {
    const enabled = document.getElementById('toggle-wa-enabled')?.checked || false;
    const primaryAccountName = document.getElementById('input-wa-primary-account-name')?.value.trim() || '';
    const primaryProvider = document.getElementById('select-wa-primary-provider')?.value || 'fonnte';

    const fallbackEnabled = document.getElementById('toggle-wa-fallback-enabled')?.checked || false;
    const fallbackAccountName = document.getElementById('input-wa-fallback-account-name')?.value.trim() || '';
    const fallbackProvider = document.getElementById('select-wa-fallback-provider')?.value || 'wapanels';

    const fallback2Enabled = document.getElementById('toggle-wa-fallback2-enabled')?.checked || false;
    const fallback2AccountName = document.getElementById('input-wa-fallback2-account-name')?.value.trim() || '';
    const fallback2Provider = document.getElementById('select-wa-fallback2-provider')?.value || 'fonnte';

    const telegramEnabled = document.getElementById('toggle-telegram-enabled')?.checked || false;
    const telegramAdminChatId = document.getElementById('input-telegram-admin-chatid')?.value.trim() || '198160734';

    try {
        await setDoc(doc(db, PATHS.settings, 'wa_config'), {
            enabled: enabled,
            primaryAccountName: primaryAccountName,
            primaryProvider: primaryProvider,
            primaryAppKey: '',
            primaryToken: '',
            fonnteToken: '',
            fallbackEnabled: fallbackEnabled,
            fallbackAccountName: fallbackAccountName,
            fallbackProvider: fallbackProvider,
            fallbackAppKey: '',
            fallbackToken: '',
            fallback2Enabled: fallback2Enabled,
            fallback2AccountName: fallback2AccountName,
            fallback2Provider: fallback2Provider,
            fallback2AppKey: '',
            fallback2Token: '',
            telegramEnabled: telegramEnabled,
            telegramBotToken: '',
            telegramAdminChatId: telegramAdminChatId,
            updatedAt: new Date().toISOString()
        }, { merge: true });

        // Reload data dan perbarui matrix
        await loadWaConfig();

        if (typeof window.logAudit === 'function') {
            window.logAudit('SUPER_ADMIN_ACTION', 'update_wa_config', null, {
                enabled, primaryProvider, fallbackEnabled, fallback2Enabled, telegramEnabled
            }, `Mengubah pengaturan 3-Tier Multi-Provider WA Gateway & Telegram Alert`);
        }

        showModernAlert("Konfigurasi Berhasil Disimpan", "Metadata provider tersimpan. Token WA/Telegram tetap dikelola sebagai secret di Cloudflare Worker dan tidak disimpan di Firestore/browser.");
    } catch (e) {
        console.error("[Settings] Gagal menyimpan konfigurasi WA:", e);
        showModernAlert("Gagal Menyimpan", `Error: ${e.message}`, "error");
    }
};

window.sendTestWaMessage = (gatewayType = 'primary') => {
    let provider = 'fonnte';
    let token = '';

    if (gatewayType === 'primary') {
        provider = document.getElementById('select-wa-primary-provider')?.value || 'fonnte';
        token = document.getElementById('input-wa-token')?.value.trim() || '';
    } else if (gatewayType === 'fallback') {
        provider = document.getElementById('select-wa-fallback-provider')?.value || 'wapanels';
        token = document.getElementById('input-wa-fallback-token')?.value.trim() || '';
    } else {
        provider = document.getElementById('select-wa-fallback2-provider')?.value || 'fonnte';
        token = document.getElementById('input-wa-fallback2-token')?.value.trim() || '';
    }

    const modal = document.getElementById('modal-test-wa-gateway');
    const inputType = document.getElementById('modal-test-wa-gateway-type');
    const badge = document.getElementById('modal-test-wa-provider-badge');
    const title = document.getElementById('modal-test-wa-title');

    if (inputType) inputType.value = gatewayType;
    if (badge) {
        const badgeName = provider === 'wapanels' ? 'WATSAP.ID' : 'FONNTE';
        const levelName = gatewayType === 'primary' ? 'PRIMARY' : (gatewayType === 'fallback' ? 'BACKUP 1' : 'BACKUP 2');
        badge.innerText = `${badgeName} (${levelName})`;
    }
    if (title) {
        title.innerText = `Uji Coba Pengiriman (${gatewayType.toUpperCase()})`;
    }

    if (modal) {
        modal.classList.remove('hidden');
        setTimeout(() => {
            const phoneInput = document.getElementById('modal-test-wa-phone');
            if (phoneInput) phoneInput.focus();
        }, 100);
    }
};

window.closeTestWaModal = () => {
    const modal = document.getElementById('modal-test-wa-gateway');
    if (modal) modal.classList.add('hidden');
};

window.submitTestWaModal = async () => {
    const gatewayType = document.getElementById('modal-test-wa-gateway-type')?.value || 'primary';
    const phoneInput = document.getElementById('modal-test-wa-phone');
    const messageInput = document.getElementById('modal-test-wa-message');
    const btnSubmit = document.getElementById('btn-modal-test-submit');

    const rawPhone = phoneInput?.value.trim() || '';
    const message = messageInput?.value.trim() || "Halo! Ini adalah pesan tes pengiriman via SIMAS SMANTARA Multi-Provider WA Gateway.";

    if (!rawPhone) {
        showModernAlert("Validasi Gagal", "Silakan masukkan nomor WhatsApp tujuan terlebih dahulu.", "error");
        return;
    }

    let provider = 'fonnte';
    let appKey = '';
    let token = '';

    if (gatewayType === 'primary') {
        provider = document.getElementById('select-wa-primary-provider')?.value || 'fonnte';
        appKey = document.getElementById('input-wa-primary-appkey')?.value.trim() || '';
        token = document.getElementById('input-wa-token')?.value.trim() || '';
    } else if (gatewayType === 'fallback') {
        provider = document.getElementById('select-wa-fallback-provider')?.value || 'wapanels';
        appKey = document.getElementById('input-wa-fallback-appkey')?.value.trim() || '';
        token = document.getElementById('input-wa-fallback-token')?.value.trim() || '';
    } else {
        provider = document.getElementById('select-wa-fallback2-provider')?.value || 'fonnte';
        appKey = document.getElementById('input-wa-fallback2-appkey')?.value.trim() || '';
        token = document.getElementById('input-wa-fallback2-token')?.value.trim() || '';
    }

    let cleanPhone = rawPhone.replace(/[^0-9]/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.substring(1);

    const originalBtnText = btnSubmit ? btnSubmit.innerHTML : '';
    if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Mengirim...';
    }

    try {
        const result = await cfClient.sendWaNotification({
            phone: cleanPhone,
            message,
            provider,
            token,
            appKey,
            targetName: gatewayType
        });

        if (result.success) {
            window.closeTestWaModal();
            showModernAlert("Pesan Terkirim", `Uji coba sukses! Pesan tes berhasil dikirim ke <b>+${cleanPhone}</b> via <b>${provider.toUpperCase()} (${gatewayType.toUpperCase()})</b>.`);
            if (typeof window.logAudit === 'function') {
                window.logAudit('SUPER_ADMIN_ACTION', 'test_wa_message', null, { target: cleanPhone, gatewayType, provider, success: true }, `Tes kirim WA (${gatewayType}) ke: ${cleanPhone}`);
            }
        } else {
            const errorMsg = result.error || result.message || JSON.stringify(result);
            showModernAlert("Pengiriman Gagal", `Gateway ${provider.toUpperCase()} (${gatewayType.toUpperCase()}) merespons dengan kesalahan:<br><b>${errorMsg}</b>`, "error");
        }
    } catch (e) {
        console.error(`[Settings] Error tes WA ${gatewayType}:`, e);
        showModernAlert("Koneksi Error", `Gagal menghubungi API Gateway (${gatewayType.toUpperCase()}):<br>${e.message}`, "error");
    } finally {
        if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = originalBtnText;
        }
    }
};

window.sendTestTelegramAlert = async () => {
    const chatId = document.getElementById('input-telegram-admin-chatid')?.value.trim();

    if (!chatId) {
        showModernAlert("Validasi Gagal", "Super Admin Chat ID wajib diisi. Token bot diambil otomatis dari Cloudflare Worker secret.", "error");
        return;
    }

    const btn = document.getElementById('btn-test-telegram');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i>Mengirim...';
    }

    try {
        const testMsg =
            `🧪 <b>[TES NOTIFIKASI TELEGRAM SIMAS]</b>\n` +
            `Halo Super Admin! Ini adalah pesan uji coba dari sistem integrasi SIMAS SMANTARA.\n\n` +
            `✅ Bot Telegram (<b>@simas_demo_bot</b>) terhubung dengan sukses ke Chat ID <code>${chatId}</code>!`;

        const result = await cfClient.sendTelegramNotification({
            chatId,
            message: testMsg,
            parseMode: 'HTML'
        });

        if (result.success) {
            showModernAlert("Telegram Alert Berhasil", `Pesan tes berhasil dikirim ke Telegram Chat ID <b>${chatId}</b> via bot.`);
            if (typeof window.logAudit === 'function') {
                window.logAudit('SUPER_ADMIN_ACTION', 'test_telegram_alert', null, { chatId, success: true }, `Melakukan tes notifikasi Telegram ke Chat ID: ${chatId}`);
            }
        } else {
            const errDetail = result.description || JSON.stringify(result);
            showModernAlert("Telegram Alert Gagal", `Gagal mengirim notifikasi Telegram:<br><b>${errDetail}</b>`, "error");
        }
    } catch (e) {
        console.error("[Settings] Error saat tes Telegram Alert:", e);
        showModernAlert("Koneksi Error", `Gagal menghubungi API Telegram:<br>${e.message}`, "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
};

window.registerTelegramWebhook = async () => {
    const btn = document.getElementById('btn-set-telegram-webhook');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-1"></i>Menghubungkan...';
    }

    try {
        const result = await cfClient.configureTelegramWebhook();
        if (result.success) {
            showModernAlert("Webhook Berhasil Didaftarkan ✅", "Bot <b>@simas_demo_bot</b> berhasil terhubung ke Cloudflare Worker dengan secret webhook aktif.", "success");
            if (typeof window.logAudit === 'function') {
                window.logAudit('SUPER_ADMIN_ACTION', 'set_telegram_webhook', null, { backend: 'cloudflare', success: true }, 'Menghubungkan Webhook Bot Telegram ke Cloudflare Worker');
            }
        } else {
            showModernAlert("Gagal Set Webhook", result.error || "Gagal mendaftarkan webhook ke Telegram API.", "error");
        }
    } catch (e) {
        console.error("[Settings] Error set Telegram Webhook:", e);
        showModernAlert("Koneksi Error", `Gagal menghubungi API Telegram:<br>${e.message}`, "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
};

// =============================================
// SECTION: PUSH NOTIFICATION SYSTEM
// =============================================

async function loadPushConfig() {
    try {
        let data = null;
        if (window.cfClient && window.cfClient.enabled) {
            data = await window.cfClient.getSystemSetting('push_config');
        }
        if (data) {
            const toggle = document.getElementById('toggle-push-enabled');
            if (toggle) {
                toggle.checked = data.enabled === true;
                document.getElementById('status-push').textContent = data.enabled ? 'Aktif' : 'Nonaktif';
                
                toggle.addEventListener('change', (e) => {
                    document.getElementById('status-push').textContent = e.target.checked ? 'Aktif' : 'Nonaktif';
                });
            }
            const inputKey = document.getElementById('input-push-public-key');
            if (inputKey) inputKey.value = data.vapidPublicKey || '';
        } else {
            const toggle = document.getElementById('toggle-push-enabled');
            if (toggle) {
                toggle.checked = false;
                document.getElementById('status-push').textContent = 'Nonaktif';
                toggle.addEventListener('change', (e) => {
                    document.getElementById('status-push').textContent = e.target.checked ? 'Aktif' : 'Nonaktif';
                });
            }
        }
    } catch (e) {
        console.error('[Settings] Gagal load push config from D1:', e);
    }
}

window.savePushConfig = async function () {
    const toggle = document.getElementById('toggle-push-enabled');
    const inputKey = document.getElementById('input-push-public-key');
    const enabled = toggle ? toggle.checked : false;
    const publicKey = inputKey ? inputKey.value.trim() : '';

    if (enabled && !publicKey) {
        showToast('Validasi Gagal', 'VAPID Public Key wajib diisi jika status aktif.', 'error');
        return;
    }

    try {
        if (window.cfClient && window.cfClient.enabled) {
            await window.cfClient.saveSystemSetting('push_config', {
                enabled,
                vapidPublicKey: publicKey,
                updatedAt: new Date().toISOString(),
                updatedBy: auth.currentUser?.uid || 'admin'
            });
        }

        document.getElementById('status-push').textContent = enabled ? 'Aktif' : 'Nonaktif';
        showToast('Berhasil', 'Pengaturan push notification berhasil disimpan.', 'success');
        
        if (enabled) {
            window.setupPushNotifications(auth.currentUser?.uid || 'admin')
                .then(() => initPushTesterPanel())
                .catch(e => console.error(e));
        }
    } catch (e) {
        console.error('[Settings] Gagal simpan push config to D1:', e);
        showToast('Gagal Menyimpan', e.message, 'error');
    }
};

async function initPushTesterPanel() {
    const permStatusEl = document.getElementById('local-permission-status');
    const tokenStatusEl = document.getElementById('local-token-status');
    const tokenInput = document.getElementById('local-device-token');
    const btnRequest = document.getElementById('btn-request-permission');

    if (!permStatusEl) return;

    const currentPermission = Notification.permission;
    permStatusEl.textContent = currentPermission === 'granted' ? 'Granted' : (currentPermission === 'denied' ? 'Denied' : 'Default');

    if (currentPermission !== 'granted') {
        btnRequest.classList.remove('hidden');
        if (currentPermission === 'denied') {
            btnRequest.innerHTML = `<i class="fa-solid fa-circle-info"></i> Panduan Buka Blokir Notifikasi`;
            btnRequest.className = "px-3 py-1 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-all font-bold flex items-center gap-1.5 cursor-pointer shadow-sm";
        }
    } else {
        btnRequest.classList.add('hidden');
    }

    try {
        const pushConfig = window.cfClient ? await window.cfClient.getSystemSetting('push_config') : null;
        if (pushConfig && pushConfig.enabled && pushConfig.vapidPublicKey) {
            const registration = await navigator.serviceWorker.ready;
            const { getMessaging, getToken } = await import("https://www.gstatic.com/firebasejs/11.0.2/firebase-messaging.js");
            const messaging = getMessaging(window.app);
            const token = await getToken(messaging, {
                serviceWorkerRegistration: registration,
                vapidKey: pushConfig.vapidPublicKey
            });
            if (token) {
                tokenInput.value = token;
                tokenStatusEl.textContent = 'Terdaftar';
                tokenStatusEl.className = 'text-green-600 font-bold';
            }
        }
    } catch (e) {
        console.warn('[Push Tester] Tidak dapat mengambil token untuk tester panel:', e);
    }
}

window.requestNotificationPermissionManual = async function() {
    try {
        if (Notification.permission === 'denied') {
            if (typeof window.showPushPermissionGuideModal === 'function') {
                window.showPushPermissionGuideModal();
            }
            return;
        }

        const permission = await Notification.requestPermission();
        if (permission === 'denied') {
            if (typeof window.showPushPermissionGuideModal === 'function') {
                window.showPushPermissionGuideModal();
            }
        } else {
            showToast('Izin Notifikasi', `Status izin: ${permission}`, permission === 'granted' ? 'success' : 'info');
        }
        initPushTesterPanel();
        if (permission === 'granted' && auth.currentUser) {
            window.setupPushNotifications(auth.currentUser.uid);
        }
    } catch (e) {
        showToast('Gagal meminta izin', e.message, 'error');
    }
};

window.copyLocalDeviceToken = function() {
    const input = document.getElementById('local-device-token');
    if (!input || !input.value) {
        showToast('Salin Gagal', 'Token tidak tersedia untuk disalin.', 'error');
        return;
    }
    input.select();
    input.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(input.value);
    showToast('Berhasil Disalin', 'Token perangkat disalin ke clipboard.', 'success');
};

// ============== SEARCHABLE COMBOBOX TARGET PENGGUNA ==============
const PUSH_ROLE_LABELS = {
    'super_admin': 'Super Admin',
    'kepala_sekolah': 'Kepala Sekolah',
    'wakasek_kurikulum': 'Wakasek Kurikulum',
    'kesiswaan': 'Wakasek Kesiswaan',
    'admin_spp': 'Admin SPP',
    'admin_perpus': 'Admin Perpus',
    'admin_sukaduka': 'Admin Suka-Duka',
    'admin_duta': 'Admin Duta',
    'kepala_lab': 'Kepala Lab',
    'staff': 'Staff',
    'wali_kelas': 'Wali Kelas',
    'guru_mapel': 'Guru Mapel',
    'guru_bk': 'Guru BK',
    'admin_pks': 'Admin PKS',
    'admin_kelas': 'Admin Kelas',
    'siswa': 'Siswa',
    'alumni': 'Alumni'
};

function getPushRoleBadgeClass(role) {
    switch (role) {
        case 'super_admin':
            return 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 border-violet-200 dark:border-violet-800/60';
        case 'kepala_sekolah':
        case 'wakasek_kurikulum':
        case 'kesiswaan':
            return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800/60';
        case 'wali_kelas':
        case 'guru_mapel':
        case 'guru_bk':
            return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800/60';
        case 'admin_spp':
        case 'admin_perpus':
        case 'admin_sukaduka':
        case 'admin_duta':
        case 'kepala_lab':
            return 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 border-purple-200 dark:border-purple-800/60';
        case 'siswa':
        case 'admin_pks':
        case 'admin_kelas':
            return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60';
        default:
            return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700';
    }
}

let pushUsersList = [];
let isPushUsersLoaded = false;
let isPushUsersLoading = false;
let isPushComboboxInitialized = false;

window.loadPushUsersList = async function(forceRefresh = false) {
    const cacheKey = 'simas_push_users_cache';
    const cacheTimeKey = 'simas_push_users_cache_time';
    const CACHE_TTL_MS = 10 * 60 * 1000; // 10 menit TTL

    if (!forceRefresh) {
        const cached = sessionStorage.getItem(cacheKey);
        const cachedTime = Number(sessionStorage.getItem(cacheTimeKey) || 0);
        if (cached && (Date.now() - cachedTime < CACHE_TTL_MS)) {
            try {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    pushUsersList = parsed;
                    isPushUsersLoaded = true;
                    return pushUsersList;
                }
            } catch (e) {
                console.warn('[Push Users] Gagal mem-parse cache pengguna:', e);
            }
        }
    }

    if (isPushUsersLoading) return pushUsersList;
    isPushUsersLoading = true;

    try {
        const snap = await getDocs(collection(db, PATHS.users));
        const list = [];
        snap.forEach(docSnap => {
            const data = docSnap.data();
            const role = data.role || 'siswa';
            const addRoles = Array.isArray(data.additionalRoles) ? data.additionalRoles : [];
            const name = (data.name || data.email?.split('@')[0] || 'Pengguna').trim();

            list.push({
                uid: docSnap.id,
                name: name,
                email: data.email || '',
                role: role,
                additionalRoles: addRoles,
                assignedClass: data.assignedClass || '',
                nip: data.nip || '',
                nis: data.nis || '',
                phone: data.phone || ''
            });
        });

        // Urutkan alfabetis nama pengguna
        list.sort((a, b) => a.name.localeCompare(b.name, 'id'));
        pushUsersList = list;
        isPushUsersLoaded = true;

        try {
            sessionStorage.setItem(cacheKey, JSON.stringify(pushUsersList));
            sessionStorage.setItem(cacheTimeKey, String(Date.now()));
        } catch (e) {}
    } catch (e) {
        console.error('[Push Users] Gagal memuat daftar pengguna:', e);
        showToast('Gagal Memuat Pengguna', e.message, 'error');
    } finally {
        isPushUsersLoading = false;
    }

    return pushUsersList;
};

window.setupPushUserCombobox = function() {
    if (isPushComboboxInitialized) return;
    const searchInput = document.getElementById('push-target-user-search');
    const dropdownList = document.getElementById('push-user-search-results');
    const container = document.getElementById('container-push-target-user');
    if (!searchInput || !dropdownList) return;

    isPushComboboxInitialized = true;

    // Event input pencarian
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        const clearBtn = document.getElementById('btn-clear-push-user');
        if (clearBtn) {
            if (query.length > 0 || document.getElementById('push-target-user-uid')?.value) {
                clearBtn.classList.remove('hidden');
            } else {
                clearBtn.classList.add('hidden');
            }
        }
        window.renderPushUserOptions(query);
    });

    // Event focus & click input: buka dropdown langsung
    const openDropdownHandler = async () => {
        if (!isPushUsersLoaded && !isPushUsersLoading) {
            window.renderPushUserLoading();
            await window.loadPushUsersList();
        }
        window.renderPushUserOptions(searchInput.value.trim());
    };

    searchInput.addEventListener('focus', openDropdownHandler);
    searchInput.addEventListener('click', openDropdownHandler);

    // Navigasi keyboard input
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            window.closePushUserDropdown();
            e.stopPropagation();
        } else if (e.key === 'ArrowDown') {
            if (dropdownList.classList.contains('hidden')) {
                openDropdownHandler();
            } else {
                const firstBtn = dropdownList.querySelector('button[data-user-uid]');
                if (firstBtn) firstBtn.focus();
            }
            e.preventDefault();
        }
    });

    // Delegasi keyboard arrow navigation pada daftar hasil
    dropdownList.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            window.closePushUserDropdown();
            searchInput.focus();
            e.preventDefault();
        } else if (e.key === 'ArrowDown') {
            const next = document.activeElement?.nextElementSibling;
            if (next && next.tagName === 'BUTTON') next.focus();
            e.preventDefault();
        } else if (e.key === 'ArrowUp') {
            const prev = document.activeElement?.previousElementSibling;
            if (prev && prev.tagName === 'BUTTON') {
                prev.focus();
            } else {
                searchInput.focus();
            }
            e.preventDefault();
        }
    });

    // Menutup dropdown saat klik di luar area kontainer
    document.addEventListener('click', (e) => {
        if (container && !container.contains(e.target)) {
            window.closePushUserDropdown();
        }
    });
};

window.renderPushUserLoading = function() {
    const dropdownList = document.getElementById('push-user-search-results');
    const searchInput = document.getElementById('push-target-user-search');
    const chevronIcon = document.getElementById('icon-push-user-chevron');
    if (!dropdownList) return;

    dropdownList.innerHTML = `
        <div class="p-4 text-center text-xs text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2">
            <i class="fa-solid fa-spinner animate-spin text-violet-600 dark:text-violet-400 text-sm"></i>
            <span>Memuat daftar pengguna sekolah...</span>
        </div>
    `;
    dropdownList.classList.remove('hidden');
    if (searchInput) searchInput.setAttribute('aria-expanded', 'true');
    if (chevronIcon) chevronIcon.classList.add('rotate-180');
};

window.renderPushUserOptions = function(queryStr = '') {
    const dropdownList = document.getElementById('push-user-search-results');
    const searchInput = document.getElementById('push-target-user-search');
    const chevronIcon = document.getElementById('icon-push-user-chevron');
    if (!dropdownList) return;

    const currentSelectedUid = (document.getElementById('push-target-user-uid')?.value || '').trim();
    const lowerQuery = (queryStr || '').toLowerCase();

    const filtered = pushUsersList.filter(u => {
        if (!lowerQuery) return true;
        const nameMatch = (u.name || '').toLowerCase().includes(lowerQuery);
        const emailMatch = (u.email || '').toLowerCase().includes(lowerQuery);
        const roleMatch = (u.role || '').toLowerCase().includes(lowerQuery) ||
            (PUSH_ROLE_LABELS[u.role] || '').toLowerCase().includes(lowerQuery);
        const classMatch = (u.assignedClass || '').toLowerCase().includes(lowerQuery);
        const nipMatch = (u.nip || '').toLowerCase().includes(lowerQuery);
        const nisMatch = (u.nis || '').toLowerCase().includes(lowerQuery);
        return nameMatch || emailMatch || roleMatch || classMatch || nipMatch || nisMatch;
    });

    if (filtered.length === 0) {
        dropdownList.innerHTML = `
            <div class="p-4 text-center text-xs text-slate-400 italic">
                <i class="fa-solid fa-user-slash text-base mb-1 block opacity-60"></i>
                Tidak ditemukan pengguna dengan kata kunci "${escapeHTML(queryStr)}"
            </div>
        `;
    } else {
        let html = '';
        filtered.forEach(u => {
            const isSelected = (u.uid === currentSelectedUid);
            const roleLabel = PUSH_ROLE_LABELS[u.role] || u.role;
            const badgeClass = getPushRoleBadgeClass(u.role);
            const roleBadge = `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold border ${badgeClass} uppercase font-mono">${escapeHTML(roleLabel)}</span>`;
            
            // Subtitle info pengguna
            const detailParts = [];
            if (u.email) detailParts.push(escapeHTML(u.email));
            if (u.assignedClass) detailParts.push(`Kelas ${escapeHTML(u.assignedClass)}`);
            if (u.nip) detailParts.push(`NIP. ${escapeHTML(u.nip)}`);
            if (u.nis) detailParts.push(`NIS. ${escapeHTML(u.nis)}`);
            const detailText = detailParts.join(' • ');

            html += `
                <button type="button" data-user-uid="${escapeHTML(u.uid)}"
                    onclick="window.selectPushUser('${escapeHTML(u.uid)}', '${escapeHTML(u.name)}', '${escapeHTML(u.role)}', '${escapeHTML(u.email)}', '${escapeHTML(detailText)}')"
                    class="w-full text-left px-3 py-2.5 hover:bg-violet-50 dark:hover:bg-violet-900/30 transition-colors flex items-center justify-between gap-2.5 ${isSelected ? 'bg-violet-50/90 dark:bg-violet-950/60 font-bold' : ''}">
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <span class="text-xs font-semibold ${isSelected ? 'text-violet-700 dark:text-violet-300' : 'text-slate-800 dark:text-slate-200'} truncate">${escapeHTML(u.name)}</span>
                            ${roleBadge}
                        </div>
                        ${detailText ? `<div class="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">${detailText}</div>` : ''}
                    </div>
                    ${isSelected ? '<i class="fa-solid fa-check text-violet-600 dark:text-violet-400 text-xs shrink-0 font-bold"></i>' : ''}
                </button>
            `;
        });
        dropdownList.innerHTML = html;
    }

    dropdownList.classList.remove('hidden');
    if (searchInput) searchInput.setAttribute('aria-expanded', 'true');
    if (chevronIcon) chevronIcon.classList.add('rotate-180');
};

window.closePushUserDropdown = function() {
    const dropdownList = document.getElementById('push-user-search-results');
    const searchInput = document.getElementById('push-target-user-search');
    const chevronIcon = document.getElementById('icon-push-user-chevron');
    if (dropdownList) dropdownList.classList.add('hidden');
    if (searchInput) searchInput.setAttribute('aria-expanded', 'false');
    if (chevronIcon) chevronIcon.classList.remove('rotate-180');
};

window.togglePushUserDropdown = async function(e) {
    if (e) e.stopPropagation();
    const dropdownList = document.getElementById('push-user-search-results');
    const searchInput = document.getElementById('push-target-user-search');
    if (!dropdownList) return;

    if (dropdownList.classList.contains('hidden')) {
        if (searchInput) searchInput.focus();
        if (!isPushUsersLoaded && !isPushUsersLoading) {
            window.renderPushUserLoading();
            await window.loadPushUsersList();
        }
        window.renderPushUserOptions(searchInput?.value.trim() || '');
    } else {
        window.closePushUserDropdown();
    }
};

window.selectPushUser = function(uid, name, role = '', email = '', detail = '') {
    const uidInput = document.getElementById('push-target-user-uid');
    const searchInput = document.getElementById('push-target-user-search');
    const nameSpan = document.getElementById('selected-push-user-name');
    const detailSpan = document.getElementById('selected-push-user-detail');
    const badge = document.getElementById('selected-push-user-badge');
    const clearBtn = document.getElementById('btn-clear-push-user');

    if (uidInput) uidInput.value = uid;
    if (searchInput) searchInput.value = name;
    if (nameSpan) nameSpan.textContent = name;
    if (detailSpan) {
        const roleLabel = PUSH_ROLE_LABELS[role] || role;
        detailSpan.textContent = detail || `${roleLabel}${email ? ' • ' + email : ''}`;
    }
    if (badge) badge.classList.remove('hidden');
    if (clearBtn) clearBtn.classList.remove('hidden');

    window.closePushUserDropdown();
};

window.clearSelectedPushUser = function(reopen = false) {
    const uidInput = document.getElementById('push-target-user-uid');
    const searchInput = document.getElementById('push-target-user-search');
    const badge = document.getElementById('selected-push-user-badge');
    const clearBtn = document.getElementById('btn-clear-push-user');

    if (uidInput) uidInput.value = '';
    if (searchInput) searchInput.value = '';
    if (badge) badge.classList.add('hidden');
    if (clearBtn) clearBtn.classList.add('hidden');

    if (reopen) {
        if (searchInput) searchInput.focus();
        window.renderPushUserOptions('');
    } else {
        window.closePushUserDropdown();
    }
};

window.filterPushUserSearch = function() {
    const query = document.getElementById('push-target-user-search')?.value.trim() || '';
    window.renderPushUserOptions(query);
};

window.handlePushTargetTypeChange = async function() {
    const targetType = document.getElementById('push-target-type').value;
    const panelRole = document.getElementById('panel-target-role');
    const panelUser = document.getElementById('panel-target-user');

    panelRole.classList.add('hidden');
    panelUser.classList.add('hidden');
    window.closePushUserDropdown();

    if (targetType === 'role') {
        panelRole.classList.remove('hidden');
    } else if (targetType === 'user') {
        panelUser.classList.remove('hidden');
        window.setupPushUserCombobox();
        if (!isPushUsersLoaded && !isPushUsersLoading) {
            window.loadPushUsersList();
        }
    }
};

window.sendTestPushNotification = async function() {
    const token = document.getElementById('local-device-token').value;
    if (!token) {
        showToast('Gagal Uji', 'Token perangkat belum terdaftar. Pastikan izin Push diaktifkan.', 'error');
        return;
    }

    const btn = document.getElementById('btn-test-push');
    btn.disabled = true;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner animate-spin mr-1"></i>Mengirim...';

    // Respons queued berarti masuk antrean, belum bukti diterima perangkat.
    try {
        const result = await cfClient.sendPushNotification({
            title: 'Uji Coba Push SIMAS',
            body: 'Selamat! Push notification bekerja dengan sukses di perangkat Anda.',
            url: './integrasi.html',
            targetType: 'user',
            targetValue: auth.currentUser.uid
        });

        showToast(result.queued ? 'Masuk Antrean' : 'Belum Dikirim', result.queued
            ? `Notifikasi uji dijadwalkan ke ${result.targetCount} perangkat akun Anda.`
            : result.reason === 'disabled' ? 'Push notifikasi sedang dinonaktifkan.' : 'Belum ada perangkat terdaftar untuk akun Anda.', result.queued ? 'success' : 'warning');
    } catch (e) {
        showToast('Gagal Uji', e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
};

window.sendManualPushNotification = async function() {
    const title = document.getElementById('push-msg-title').value.trim();
    const body = document.getElementById('push-msg-body').value.trim();
    const url = document.getElementById('push-msg-url').value.trim() || './dashboard.html';
    const targetType = document.getElementById('push-target-type').value;

    if (!title || !body) {
        showToast('Validasi Gagal', 'Judul dan isi pesan notifikasi wajib diisi.', 'error');
        return;
    }

    let targetValue = '';
    if (targetType === 'role') {
        const checkboxes = document.querySelectorAll('input[name="push-role"]:checked');
        const roles = Array.from(checkboxes).map(cb => cb.value);
        if (roles.length === 0) {
            showToast('Validasi Gagal', 'Pilih minimal satu peran (role) target.', 'error');
            return;
        }
        // Sertakan alias guru saat guru_mapel dipilih agar seluruh akun guru terjaring
        if (roles.includes('guru_mapel') && !roles.includes('guru')) {
            roles.push('guru');
        }
        targetValue = roles.join(',');
    } else if (targetType === 'user') {
        targetValue = document.getElementById('push-target-user-uid').value;
        if (!targetValue) {
            showToast('Validasi Gagal', 'Cari dan pilih satu target pengguna.', 'error');
            return;
        }
    } else {
        targetValue = 'all';
    }

    const btn = document.getElementById('btn-send-push');
    btn.disabled = true;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner animate-spin mr-1"></i>Mengirim...';

    try {
        const result = await cfClient.sendPushNotification({
            title,
            body,
            url,
            targetType,
            targetValue
        });

        // Job selalu tersimpan di lonceng (Notification Center) penerima, walau tanpa
        // perangkat push. Form tetap dikosongkan agar admin tidak mengira gagal lalu
        // mengirim ulang (menggandakan notifikasi di lonceng).
        if (!result.queued) {
            showToast('Tersimpan di Lonceng', result.reason === 'disabled'
                ? 'Push notifikasi sedang dinonaktifkan; pesan tetap tampil di lonceng penerima.'
                : 'Pesan tampil di lonceng penerima, namun belum ada perangkat push terdaftar yang sesuai target.', 'info');
        } else {
            showToast('Masuk Antrean', `Pesan tampil di lonceng penerima dan dijadwalkan ke ${result.targetCount} perangkat push.`, 'success');
        }

        document.getElementById('push-msg-title').value = '';
        document.getElementById('push-msg-body').value = '';
        window.clearSelectedPushUser();
        
        document.querySelectorAll('input[name="push-role"]').forEach(cb => cb.checked = false);
    } catch (e) {
        showToast('Gagal Mengirim', e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
};
