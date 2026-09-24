@echo off
setlocal
chcp 65001 >nul
set ELECTRON_RUN_AS_NODE=
set PYTHONIOENCODING=utf-8
set VOICE_CLOUD_FALLBACK=1
cd /d "%~dp0"
node scripts\ensureTts.js
if errorlevel 1 (
  echo Failed to prepare TTS.
  pause
  exit /b 1
)
node scripts\ensureStt.js
if errorlevel 1 (
  echo Failed to prepare STT.
  pause
  exit /b 1
)
node_modules\electron\dist\electron.exe .
endlocal
