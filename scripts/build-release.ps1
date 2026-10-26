param([switch]$SkipSmoke)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
Set-Location -LiteralPath $root
$python = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw 'Create .venv and install requirements.txt and requirements-build.txt first.' }
& node scripts/build-web.mjs
if ($LASTEXITCODE -ne 0) { throw 'Web application bundle build failed' }
& $python -m PyInstaller --noconfirm Folio.spec
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller build failed' }
if (-not $SkipSmoke) {
    & $python scripts/smoke-release.py dist/Folio/Folio.exe
    if ($LASTEXITCODE -ne 0) { throw 'Portable smoke test failed' }
}
$package = Join-Path $root 'dist\Folio'
foreach ($document in @('README.md', 'CHANGELOG.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md', 'CONTRIBUTING.md', 'CONTRIBUTING.zh-CN.md', 'requirements.txt', 'requirements-desktop.txt', 'requirements-build.txt', 'Folio.spec')) {
    Copy-Item -LiteralPath (Join-Path $root $document) -Destination $package -Force
}
$docs = Join-Path $package 'docs'
New-Item -ItemType Directory -Force -Path $docs | Out-Null
Get-ChildItem -LiteralPath (Join-Path $root 'docs') | Copy-Item -Destination $docs -Recurse -Force
Copy-Item -LiteralPath (Join-Path $root 'examples') -Destination $package -Recurse -Force
$versionInfo = & $python -c "import sys,ssl,importlib.metadata as m; print('Python '+sys.version); print(ssl.OPENSSL_VERSION); print('PyInstaller '+m.version('pyinstaller')); print('pystray '+m.version('pystray'))"
[IO.File]::WriteAllText((Join-Path $package 'BUILD-INFO.txt'), (($versionInfo -join "`n") + "`nBuilt UTC: " + [DateTime]::UtcNow.ToString('o') + "`nUnsigned Windows x64 development build.`n"))
$destination = Join-Path $root 'dist\Folio-1.2.0-windows-x64.zip'
Compress-Archive -LiteralPath (Join-Path $root 'dist\Folio') -DestinationPath $destination -Force
$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $destination
[IO.File]::WriteAllText("$destination.sha256", ($hash.Hash.ToLower() + '  ' + [IO.Path]::GetFileName($destination) + "`n"))
Write-Output $destination
