@echo off
rem ============================================================
rem  stop.bat - Stop the ParadiseRP Complaint Bot COMPLETELY
rem  (bot process + the scheduled watchdog task)
rem  Run start.bat again to bring the bot back online.
rem  ASCII only! Persian text inside .bat breaks cmd parsing.
rem ============================================================
cd /d "%~dp0"
title ParadiseRP Complaint Bot [STOPPER]

echo ============================================================
echo   ParadiseRP Complaint Bot - Stopper
echo ============================================================
echo.

rem ---- Disable the scheduled watchdog task (if it exists) ----
schtasks /Change /TN "ParadiseBotWatchdog" /DISABLE >nul 2>&1

rem ---- Kill ONLY the bot process (the PID holding lock port 49160) ----
set FOUND=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /c:"127.0.0.1:49160" ^| findstr /c:"LISTENING"') do (
    taskkill /F /T /PID %%p >nul 2>&1
    set FOUND=1
)

if defined FOUND (
    echo [OK] Bot stopped. Watchdog task is disabled.
) else (
    echo [INFO] Bot was not running. Watchdog task is disabled anyway.
)
echo.
echo      Run start.bat to bring the bot back online.
echo.
pause
