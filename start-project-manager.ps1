$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'Node.js is required. Install it from https://nodejs.org then run this again.'
}
Write-Host 'Starting the Regency Project Manager on http://localhost:4173'
Write-Host 'Press Ctrl+C to stop.'
node dev-server.mjs
