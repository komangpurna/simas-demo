# Skrip Generator Keystore Penandatangan Android SIMAS SMAGESA
# Menghasilkan file android.keystore dan mengekstrak SHA-256 Fingerprint untuk Digital Asset Links

$ErrorActionPreference = "Stop"

$KEYSTORE_FILE = "android.keystore"
$KEY_ALIAS = "android"
$STORE_PASS = "smagesa123!"
$KEY_PASS = "smagesa123!"
$DNAME = "CN=SMAN 1 Abang, OU=IT SIMAS, O=SMA Negeri 1 Abang, L=Abang, ST=Bali, C=ID"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   SIMAS SMAGESA - Pembuat Android Keystore & SHA-256    " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

if (Test-Path $KEYSTORE_FILE) {
    Write-Host "[INFO] Keystore '$KEYSTORE_FILE' sudah ada. Mengekstrak SHA-256 fingerprint..." -ForegroundColor Yellow
} else {
    Write-Host "[1/3] Membuat keystore baru: $KEYSTORE_FILE..." -ForegroundColor Green
    & keytool -genkeypair `
        -v `
        -keystore $KEYSTORE_FILE `
        -alias $KEY_ALIAS `
        -keyalg RSA `
        -keysize 2048 `
        -validity 10000 `
        -storepass $STORE_PASS `
        -keypass $KEY_PASS `
        -dname $DNAME
    Write-Host "[OK] Keystore berhasil dibuat!" -ForegroundColor Green
}

Write-Host "[2/3] Mengekstrak SHA-256 Certificate Fingerprint..." -ForegroundColor Green
$certInfo = & keytool -list -v -keystore $KEYSTORE_FILE -alias $KEY_ALIAS -storepass $STORE_PASS

$sha256Line = $certInfo | Where-Object { $_ -match "SHA256:\s*([0-9A-Fa-f:]+)" }
if ($sha256Line -match "SHA256:\s*([0-9A-Fa-f:]+)") {
    $sha256 = $matches[1].Trim().ToUpper()
    Write-Host "----------------------------------------------------------" -ForegroundColor Gray
    Write-Host "SHA-256 Fingerprint:" -ForegroundColor Cyan
    Write-Host $sha256 -ForegroundColor Yellow
    Write-Host "----------------------------------------------------------" -ForegroundColor Gray

    # Update assetlinks.json template
    $assetLinksPath = Join-Path (Get-Location).Path "..\.well-known\assetlinks.json"
    if (Test-Path $assetLinksPath) {
        Write-Host "[3/3] Memperbarui fingerprint pada: $assetLinksPath..." -ForegroundColor Green
        $json = Get-Content $assetLinksPath -Raw | ConvertFrom-Json
        $json[0].target.sha256_cert_fingerprints = @($sha256)
        @($json) | ConvertTo-Json -Depth 10 | Set-Content $assetLinksPath -Encoding UTF8
        Write-Host "[OK] .well-known/assetlinks.json berhasil diperbarui!" -ForegroundColor Green
    }
} else {
    Write-Host "[PERINGATAN] Gagal membaca SHA-256 fingerprint secara otomatis. Silakan periksa output keytool:" -ForegroundColor Red
    $certInfo | Out-String | Write-Host
}

Write-Host "`nSelesai! Simpan file '$KEYSTORE_FILE' dan password '$STORE_PASS' dengan aman!" -ForegroundColor Green
