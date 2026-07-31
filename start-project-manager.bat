@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install it from https://nodejs.org then run this again.
  pause
  exit /b 1
)
echo Starting the Regency Project Manager on http://localhost:4173
echo Press Ctrl+C to stop.
node dev-server.mjs
