@echo off
setlocal
set ELECTRON_RUN_AS_NODE=1
cd /d "%~dp0"
..\node_modules\electron\dist\electron.exe testVoskLoad.js
pause
endlocal