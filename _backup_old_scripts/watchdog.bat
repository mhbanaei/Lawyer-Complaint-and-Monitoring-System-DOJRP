@echo off
rem ============================================================
rem  Watchdog - ParadiseRP Complaint Bot (ASCII only!)
rem  Registered by start.bat as a Windows Scheduled Task that
rem  runs this file EVERY 1 MINUTE.
rem  If the bot is NOT running (its single-instance lock port
rem  is not listening), it starts the bot again automatically.
rem  To stop the bot COMPLETELY use stop.bat
rem ============================================================
cd /d "%~dp0"

rem ---- Is the bot alive? (lock port 49160 listening) ----
set ALIVE=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /c:"127.0.0.1:49160" ^| findstr /c:"LISTENING"') do set ALIVE=1

if defined ALIVE goto done

rem ---- Bot is OFF: revive it (hidden/minimized, output to bot.log) ----
echo [%date% %time%] Bot was OFF - Watchdog restarted it automatically. >> watchdog.log
start "ParadiseBot" /min "%~dp0run-bot.bat"

:done
exit /b 0
