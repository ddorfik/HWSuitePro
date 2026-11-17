@echo off
title HandwerkPro
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js wurde nicht gefunden.
  echo Bitte Node.js 24 oder neuer installieren: https://nodejs.org
  pause
  exit /b 1
)
echo Starte HandwerkPro auf http://localhost:3000 ...
start "HandwerkPro Server" cmd /c "node server.js"
timeout /t 2 /nobreak >nul
start "" http://localhost:3000
