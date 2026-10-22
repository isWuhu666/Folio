param(
    [string]$ToolsRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) '../.tools'),
    [switch]$SkipAssets,
    [string]$SigningProfile
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$ToolsRoot = [IO.Path]::GetFullPath($ToolsRoot)
$env:GRADLE_USER_HOME = Join-Path $ToolsRoot 'gradle-home'
$env:ANDROID_USER_HOME = Join-Path $ToolsRoot 'android-user'
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $ToolsRoot 'android-sdk' }
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = 'C:/Program Files/Microsoft/jdk-21.0.12.101-hotspot' }
$gradle = Join-Path $ToolsRoot 'gradle-8.13/bin/gradle.bat'
if (-not (Test-Path $gradle)) { throw 'Gradle 8.13 missing. See docs/android-build.md for pinned toolchain setup.' }
if (-not (Test-Path (Join-Path $env:ANDROID_HOME 'platforms/android-35/android.jar'))) { throw 'Android SDK 35 missing. See docs/android-build.md.' }
$signingVariables = @('FOLIO_ANDROID_KEYSTORE','FOLIO_ANDROID_STORE_PASSWORD','FOLIO_ANDROID_KEY_ALIAS','FOLIO_ANDROID_KEY_PASSWORD')
$previousSigning = @{}
foreach ($name in $signingVariables) { $previousSigning[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
$isReleaseSigning = $false
try {
if ($SigningProfile) {
    $profile = Get-Content -LiteralPath $SigningProfile -Raw | ConvertFrom-Json
    $secure = ConvertTo-SecureString -String $profile.protectedPassword
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $env:FOLIO_ANDROID_STORE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    $env:FOLIO_ANDROID_KEYSTORE = $profile.keystore
    $env:FOLIO_ANDROID_KEY_ALIAS = $profile.alias
    $env:FOLIO_ANDROID_KEY_PASSWORD = $env:FOLIO_ANDROID_STORE_PASSWORD
}
if ($env:FOLIO_ANDROID_KEYSTORE) {
    if (-not (Test-Path -LiteralPath $env:FOLIO_ANDROID_KEYSTORE)) { throw 'Configured signing keystore does not exist.' }
    if (-not $env:FOLIO_ANDROID_STORE_PASSWORD -or -not $env:FOLIO_ANDROID_KEY_ALIAS) { throw 'Custom signing requires STORE_PASSWORD and KEY_ALIAS environment variables.' }
    $isReleaseSigning = $true
} else {
    if ($env:FOLIO_ANDROID_STORE_PASSWORD -or $env:FOLIO_ANDROID_KEY_ALIAS -or $env:FOLIO_ANDROID_KEY_PASSWORD) { throw 'Signing variables are incomplete: KEYSTORE is required.' }
    $env:FOLIO_ANDROID_KEYSTORE = Join-Path $ToolsRoot 'folio-development.keystore'
}
if (-not $isReleaseSigning -and -not (Test-Path $env:FOLIO_ANDROID_KEYSTORE)) {
    & (Join-Path $env:JAVA_HOME 'bin/keytool.exe') -genkeypair -keystore $env:FOLIO_ANDROID_KEYSTORE -storepass android -keypass android -alias androiddebugkey -dname 'CN=Folio Development, O=Local Sideload, C=CN' -keyalg RSA -keysize 2048 -validity 10000
    if ($LASTEXITCODE) { throw 'Cannot generate local development signing key' }
}
Push-Location $projectRoot
try {
    if (-not $SkipAssets) {
        & node scripts/prepare-vendor.mjs
        if ($LASTEXITCODE) { throw 'Vendor asset preparation failed' }
        & node scripts/prepare-android-assets.mjs
        if ($LASTEXITCODE) { throw 'Android asset preparation failed' }
    }
    & $gradle -p android --no-daemon :app:exportStateTest :app:lintRelease :app:assembleRelease
    if ($LASTEXITCODE) { throw 'Android build or verification failed' }
    New-Item -ItemType Directory -Force dist | Out-Null
    $apk = Join-Path $projectRoot 'dist/Folio-1.2.0-android.apk'
    Copy-Item android/app/build/outputs/apk/release/app-release.apk $apk -Force
    & (Join-Path $env:ANDROID_HOME 'build-tools/35.0.0/apksigner.bat') verify --verbose --print-certs $apk
    if ($LASTEXITCODE) { throw 'APK signature verification failed' }
    $hash = (Get-FileHash $apk -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  Folio-1.2.0-android.apk" | Set-Content (Join-Path $projectRoot 'dist/Folio-1.2.0-android.apk.sha256') -Encoding ascii
    $signingLabel = if ($isReleaseSigning) { 'maintainer-key-signed' } else { 'development-signed' }
    Write-Output "Built $signingLabel sideload APK: $apk"
    Write-Output "SHA256: $hash"
} finally { Pop-Location }
} finally {
    foreach ($name in $signingVariables) { [Environment]::SetEnvironmentVariable($name,$previousSigning[$name],'Process') }
}
