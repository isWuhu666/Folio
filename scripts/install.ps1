$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
function Check-Exit([string]$Step) {
    if ($LASTEXITCODE -ne 0) { throw "$Step failed. Fix the error above and run install again." }
}
try {
    if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
        py -m venv .venv
        Check-Exit 'Create Python environment'
    }
    & '.\.venv\Scripts\python.exe' -m pip install -r requirements.txt
    Check-Exit 'Install Python dependencies'
    npm.cmd ci
    Check-Exit 'Install browser dependencies'
    npm.cmd run prepare:vendor
    Check-Exit 'Prepare local assets'
    Write-Host 'Installation complete. Run 启动.cmd.'
} catch {
    Write-Host $_ -ForegroundColor Red
    Write-Host 'After correcting the error, run 安装.cmd again.'
    exit 1
}
