@echo off
rem ASCII-only batch file! (Persian text inside .bat breaks cmd parsing)
rem The Persian banner is printed by the bot itself (index.js) at startup.
rem This script installs EVERYTHING the bot needs automatically:
rem   1. Node.js (auto-download + silent install if missing)
rem   2. npm dependencies (npm install)
rem   3. Slash command registration
rem   4. Auto SSL certificate for SSL_DOMAIN in .env
rem   5. Runs the bot ONCE. Closing this window (X) or Ctrl+C stops everything.
chcp 65001 >nul
title ParadiseRP Complaint Bot [SETUP]
mode con: cols=100 lines=40
cd /d "%~dp0"

rem ---- Auto-elevate to Administrator (needed for ports 80/443 and Node.js install) ----
rem If elevation is denied/canceled we CONTINUE anyway (bot runs; only low ports may fail)
net session >nul 2>&1
if errorlevel 1 (
    echo [INFO] Requesting Administrator rights...
    echo        ^(needed for HTTPS ports 80/443 and automatic Node.js install^)
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" >nul 2>&1
    if errorlevel 1 (
        echo [WARN] Administrator rights were NOT granted ^(UAC canceled^).
        echo        Continuing anyway - the bot will run, but ports 80/443
        echo        and automatic Node.js install may fail without admin.
        echo.
        ping -n 4 127.0.0.1 >nul
    ) else (
        echo [OK] Elevated window opened. This window can be closed.
        ping -n 3 127.0.0.1 >nul
        exit /b 0
    )
)

:boot
cls
echo ============================================================
echo   ParadiseRP Complaint Bot - Auto Setup
echo   All prerequisites are installed automatically.
echo ============================================================
echo.

rem ---- Open firewall for HTTP/HTTPS inbound (idempotent) ----
rem HTTP(80) is required for the Let's Encrypt challenge; WEB_SSL_PORT (default 443) serves the form.
for /f "tokens=1,2 delims==" %%a in ('findstr /b "WEB_SSL_PORT=" .env 2^>nul') do set SSLPORT=%%b
if not defined SSLPORT set SSLPORT=443
set SSLPORT=%SSLPORT: =%
echo [SETUP] Ensuring firewall rules for ports 80 and %SSLPORT%...
netsh advfirewall firewall delete rule name="ParadiseBot HTTP" >nul 2>&1
netsh advfirewall firewall delete rule name="ParadiseBot HTTPS" >nul 2>&1
netsh advfirewall firewall add rule name="ParadiseBot HTTP" dir=in action=allow protocol=TCP localport=80 >nul 2>&1
netsh advfirewall firewall add rule name="ParadiseBot HTTPS" dir=in action=allow protocol=TCP localport=%SSLPORT% >nul 2>&1
echo [OK] Firewall rules ready.
echo.

rem ---- Step 1: Node.js (install automatically if missing) ----
set NEEDNODE=0
where node >nul 2>nul
if errorlevel 1 set NEEDNODE=1
if "%NEEDNODE%"=="1" goto installnode
goto nodeready

:installnode
echo [SETUP] Node.js not found. Installing automatically...
echo.
where winget >nul 2>nul
if not errorlevel 1 (
    echo [SETUP] Trying winget first...
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements --silent
)
where node >nul 2>nul
if not errorlevel 1 goto nodeready

rem -- Fallback: download official LTS MSI from nodejs.org and install silently --
echo [SETUP] Downloading Node.js LTS from nodejs.org ...
> "%TEMP%\install-node.ps1" echo $ErrorActionPreference = 'Stop'
>> "%TEMP%\install-node.ps1" echo $r = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
>> "%TEMP%\install-node.ps1" echo $v = ($r ^| Where-Object { $_.lts } ^| Select-Object -First 1).version
>> "%TEMP%\install-node.ps1" echo $u = "https://nodejs.org/dist/$v/node-$v-x64.msi"
>> "%TEMP%\install-node.ps1" echo Write-Host '        Downloading ' $u
>> "%TEMP%\install-node.ps1" echo Invoke-WebRequest -Uri $u -OutFile "$env:TEMP\node-lts.msi" -UseBasicParsing
>> "%TEMP%\install-node.ps1" echo Write-Host '        Installing silently...'
>> "%TEMP%\install-node.ps1" echo Start-Process msiexec.exe -ArgumentList '/i',"$env:TEMP\node-lts.msi",'/qn','/norestart' -Wait -Verb RunAs
>> "%TEMP%\install-node.ps1" echo Write-Host '        Done.'
powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP%\install-node.ps1"
if errorlevel 1 (
    echo [ERROR] Node.js download/install failed!
    echo         Check your internet connection, then run start.bat again.
    pause
    exit /b 1
)
set "PATH=%PATH%;C:\Program Files\nodejs"

:nodeready
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is still not available after install.
    echo         Close this window and run start.bat again.
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node --version') do set NODEVER=%%v
echo [OK] Node.js %NODEVER% ready.
echo.

rem ---- Check .env (create from template on first run) ----
if exist .env goto envready
if not exist .env.example goto noenv
echo [SETUP] Creating .env from .env.example ...
copy /y .env.example .env >nul
echo [WARN] .env was created from the template!
echo        Fill in BOT_TOKEN, CLIENT_ID, role/channel IDs in the opened editor,
echo        save it, then run start.bat again.
notepad .env
pause
exit /b 1

:noenv
echo [ERROR] .env file not found!
pause
exit /b 1

:envready
where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm not found even though Node.js is installed?!
    echo         Reinstall Node.js from https://nodejs.org and try again.
    pause
    exit /b 1
)

rem ---- Step 2: npm dependencies (install/refresh automatically) ----
rem (also runs when node_modules was copied without the SSL library)
if exist node_modules\acme-client goto depsready
echo [SETUP] Installing dependencies (npm install)...
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo [ERROR] npm install failed! Check your internet connection.
    pause
    exit /b 1
)
echo [OK] Dependencies installed.
echo.

:depsready
rem ---- Step 3: Register slash commands (every run - always fresh commands) ----
echo [SETUP] Registering slash commands...
node deploy-commands.js
if errorlevel 1 (
    echo [ERROR] Command registration failed! Check BOT_TOKEN and CLIENT_ID in .env
    echo        Bot will start anyway; commands may be outdated.
    echo.
)
echo [OK] Commands registered.
echo.

:cmdready
rem ---- Step 4: NO auto-restart - make sure no watchdog task exists ----
echo [SETUP] Removing any old auto-restart watchdog task...
schtasks /Delete /TN "ParadiseBotWatchdog" /F >nul 2>&1
schtasks /Change /TN "ParadiseBotWatchdog" /DISABLE >nul 2>&1
echo [OK] No auto-restart. The bot runs only while this window stays open.
echo.

rem ---- Sanity: node must exist right before running (prevents 9009 restart-loop) ----
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found in PATH right before start!
    echo         Close this window and run start.bat again.
    pause
    exit /b 1
)
echo [%time%] Starting bot... live logs below:
echo      (first run with SSL_DOMAIN may take up to a minute for the certificate)
echo ------------------------------------------------------------
title ParadiseRP Complaint Bot [RUNNING]
rem (no crash counter / no auto-restart - the bot runs once per start.bat)

node index.js
set RC=%errorlevel%
if "%RC%"=="130" (
    echo.
echo [INFO] Bot stopped by user. Everything closed - nothing restarts by itself.
exit /b 0
)
if "%RC%"=="2" (
    echo.
echo [ERROR] The bot is ALREADY RUNNING in another window!
echo         Close that window first, then run start.bat again.
exit /b 2
)
if "%RC%"=="3" (
    echo.
echo [ERROR] Invalid bot token!
echo         1. Press Reset Token in the Discord Developer Portal
echo         2. Paste the new token into .env on the BOT_TOKEN line
echo         3. Save .env and run start.bat again
exit /b 3
)
echo.
echo [%time%] [ERROR] The bot crashed (exit code %RC%). Fix the issue,
echo        then run start.bat again.
pause & exit /b %RC%
