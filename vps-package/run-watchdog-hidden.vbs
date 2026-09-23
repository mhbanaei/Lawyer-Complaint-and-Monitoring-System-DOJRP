' ============================================================
' Runs watchdog.bat COMPLETELY HIDDEN (no console flash)
' Used by the scheduled task registered in watchdog-register.ps1
' ============================================================
Dim fso, dir, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = """" & dir & "\watchdog.bat"""
CreateObject("WScript.Shell").Run cmd, 0, False
