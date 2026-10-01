param([string]$Python = "python")
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    & $Python -m PyInstaller --noconfirm --onefile --windowed --workpath build\sync-fix --name GlobalMarketCalendarDesktopVisible app.py
    if ($LASTEXITCODE -ne 0) { throw '打包失败' }
    Write-Host '完成：dist\GlobalMarketCalendarDesktopVisible.exe'
} finally { Pop-Location }
