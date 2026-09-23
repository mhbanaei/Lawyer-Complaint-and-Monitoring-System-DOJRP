@echo off
rem ============================================================
rem  Runs the bot (used by watchdog.bat for silent auto-restart)
rem  Output goes to bot.log so nothing flashes on screen.
rem ============================================================
cd /d "%~dp0"

rem ---- Find node.exe (PATH first, then default install dir) ----
where node >nul 2>nul
if errorlevel 1 set "PATH=%PATH%;C:\Program Files\nodejs"

rem ---- Keep bot.log from growing forever (rotate at 10 MB) ----
if exist bot.log (
    for %%A in (bot.log) do if %%~zA GTR 10485760 copy /y nul bot.log >nul
)

node index.js >> bot.log 2>&1
