@echo off
setlocal
chcp 65001 >nul
set ELECTRON_RUN_AS_NODE=
set PYTHONIOENCODING=utf-8
set OPENROUTER_API_KEY=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
set VOICE_CLOUD_FALLBACK=1
cd /d "%~dp0"
node scripts\ensureTts.js
if errorlevel 1 (
  echo Failed to prepare TTS.
  pause
  exit /b 1
)
node_modules\electron\dist\electron.exe .
endlocal
