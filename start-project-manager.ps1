$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (Get-Command py -ErrorAction SilentlyContinue) {
  py -m http.server 4173
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  python -m http.server 4173
} else {
  Write-Error 'Python is required. Install Python or run the app from another local static server.'
}

