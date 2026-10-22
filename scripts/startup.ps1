param(
    [ValidateSet('Enable', 'Disable', 'Status')]
    [string]$Mode = 'Status',
    [string]$ExecutablePath = '',
    [ValidateRange(1, 65535)]
    [int]$Port = 8765,
    [string]$StartupDirectory = [Environment]::GetFolderPath('Startup')
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$startupRoot = [IO.Path]::GetFullPath($StartupDirectory)
$shortcutPath = Join-Path $startupRoot 'Folio Background.lnk'
$pythonPath = Join-Path $projectRoot '.venv\Scripts\pythonw.exe'
$desktopPath = Join-Path $projectRoot 'desktop.py'
$arguments = '"' + $desktopPath + '" --no-browser'
if ($ExecutablePath) {
    $pythonPath = [IO.Path]::GetFullPath($ExecutablePath)
    $projectRoot = Split-Path -Parent $pythonPath
    $arguments = '--no-browser'
}
if ($Port -ne 8765) { $arguments += ' --port ' + $Port }
$marker = 'Managed by Folio background startup v1'
$shell = New-Object -ComObject WScript.Shell

function Read-Entry {
    if (-not (Test-Path -LiteralPath $shortcutPath)) { return $null }
    if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) {
        throw "Startup entry is not a file: $shortcutPath"
    }
    return $shell.CreateShortcut($shortcutPath)
}

$entry = Read-Entry
if ($Mode -ne 'Status' -and $entry -and $entry.Description -ne $marker) {
    throw "An unrelated startup entry exists. Nothing was changed: $shortcutPath"
}

if ($Mode -eq 'Enable') {
    $requiredFiles = @($pythonPath)
    if (-not $ExecutablePath) { $requiredFiles += @($desktopPath, (Join-Path $projectRoot 'web\vendor\mathjax\tex-svg.js')) }
    foreach ($required in $requiredFiles) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
            throw "Local dependencies are missing. Run the installation script first: $required"
        }
    }
    [IO.Directory]::CreateDirectory($startupRoot) | Out-Null
    $entry = $shell.CreateShortcut($shortcutPath)
    $entry.TargetPath = $pythonPath
    $entry.Arguments = $arguments
    $entry.WorkingDirectory = $projectRoot
    $entry.Description = $marker
    $entry.WindowStyle = 7
    $entry.Save()
} elseif ($Mode -eq 'Disable' -and $entry) {
    # Only the exact, marker-verified Folio shortcut is removed; never its directory.
    Remove-Item -LiteralPath $shortcutPath
}

$entry = Read-Entry
$matches = $false
if ($entry) {
    $matches = ($entry.Description -eq $marker -and $entry.TargetPath -eq $pythonPath -and
                $entry.Arguments -eq $arguments -and $entry.WorkingDirectory -eq $projectRoot)
}
[pscustomobject]@{
    enabled = [bool]$matches
    matchesProject = [bool]$matches
    path = $shortcutPath
    target = $(if ($entry) { $entry.TargetPath } else { $null })
    arguments = $(if ($entry) { $entry.Arguments } else { $null })
} | ConvertTo-Json -Compress
