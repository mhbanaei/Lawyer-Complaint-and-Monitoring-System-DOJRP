# ============================================================
# watchdog-register.ps1 - Registers the ParadiseBotWatchdog task
# - Runs watchdog.bat (hidden) every 1 minute
# - Survives reboots (StartWhenAvailable) and missed ticks
# - Safe with paths containing spaces (uses full object API)
# ============================================================
$ErrorActionPreference = 'Stop'

$dir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbs    = Join-Path $dir 'run-watchdog-hidden.vbs'

$action   = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $vbs + '"')
$trigger  = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName 'ParadiseBotWatchdog' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host '[OK] Watchdog task registered: checks every 1 minute, revives the bot automatically if it goes offline (even after reboot).'
