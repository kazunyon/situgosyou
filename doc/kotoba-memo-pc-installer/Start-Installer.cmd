@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "%~dp0KotobaMemoInstaller.ps1"
if errorlevel 1 (
  echo Installer could not start. Open README.md for help.
  pause
)
