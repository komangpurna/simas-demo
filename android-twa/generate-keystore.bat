@echo off
setlocal
echo ==========================================================
echo    SIMAS SMAGESA - Pembuat Android Keystore ^& SHA-256
echo ==========================================================
powershell -ExecutionPolicy Bypass -File "%~dp0generate-keystore.ps1"
pause
