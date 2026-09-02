@echo off
setlocal
cd /d "%~dp0"
set "RENDERER_URL=http://127.0.0.1:8765/"
start "" "%RENDERER_URL%"
echo FE Awakening live renderer: %RENDERER_URL%
echo Keep this window open. Press Ctrl+C to stop.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" -Root "%CD%" -Port 8765
