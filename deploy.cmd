@echo off
rem ============================================================
rem  deploy.cmd - Build a CLEAN VPS package
rem  Creates "vps-package" next to this script:
rem    - all project source files
rem    - .env included so you only tweak values on the VPS
rem  Excludes: node_modules, data, logs, ssl, .deployed, bot.log
rem  On the VPS: copy the folder -> double-click start.bat -> done
rem ============================================================
setlocal
cd /d "%~dp0"

echo ============================================================
echo   Building clean VPS package...
echo ============================================================
echo.

if exist vps-package rmdir /s /q vps-package
mkdir vps-package

rem ---- Source files ----
for %%F in (index.js deploy-commands.js package.json package-lock.json start.bat .env .env.example README.md) do (
    if exist "%%F" copy /y "%%F" vps-package\ >nul
)

rem ---- Source folders ----
for %%D in (src test) do (
    if exist "%%D" xcopy "%%D" "vps-package\%%D\" /e /i /q >nul
)

echo [OK] Package built: vps-package\
echo.
echo Contents:
dir /b vps-package
echo.
echo ============================================================
echo   NEXT STEPS:
echo   1. Copy the whole "vps-package" folder to the VPS
echo      (RDP: right-click folder - Copy, then paste on VPS)
echo   2. On the VPS, double-click start.bat
echo   3. Approve the Administrator prompt (UAC)
echo   4. Wait for: [SSL] certificate issued + HTTPS ready
echo   5. Open https://lspd.ir/Shekayat
echo ============================================================
pause
