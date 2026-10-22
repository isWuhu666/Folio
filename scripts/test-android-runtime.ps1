param(
    [string]$Serial = 'emulator-5560',
    [string]$AvdName = 'FolioSmoke',
    [string]$ToolsRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) '../.tools'),
    [string]$OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) 'artifacts/android-runtime'),
    [switch]$SkipBuild,
    [switch]$IncludePdfImport
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$ToolsRoot = [IO.Path]::GetFullPath($ToolsRoot)
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$env:ANDROID_HOME = Join-Path $ToolsRoot 'android-sdk'
$env:ANDROID_USER_HOME = Join-Path $ToolsRoot 'android-user'
$env:GRADLE_USER_HOME = Join-Path $ToolsRoot 'gradle-home'
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = 'C:/Program Files/Microsoft/jdk-21.0.12.101-hotspot' }
$adb = Join-Path $env:ANDROID_HOME 'platform-tools/adb.exe'
$gradle = Join-Path $ToolsRoot 'gradle-8.13/bin/gradle.bat'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

# Never select the first connected device: installing or driving UI needs an explicit dedicated AVD.
if ($Serial -notmatch '^emulator-\d+$') { throw 'Runtime smoke requires a dedicated emulator serial.' }
$identity = @(& $adb -s $Serial emu avd name 2>&1)
if ($LASTEXITCODE -ne 0 -or $identity[0].ToString().Trim() -ne $AvdName) {
    throw "AVD identity mismatch for $Serial; expected $AvdName. No APKs installed."
}
$booted = & $adb -s $Serial shell getprop sys.boot_completed
if ($LASTEXITCODE -ne 0 -or "$booted".Trim() -ne '1') { throw "AVD $Serial has not completed boot." }

$signingNames = @('FOLIO_ANDROID_KEYSTORE','FOLIO_ANDROID_STORE_PASSWORD','FOLIO_ANDROID_KEY_ALIAS','FOLIO_ANDROID_KEY_PASSWORD')
$previousSigning = @{}
foreach ($name in $signingNames) { $previousSigning[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
try {
    # This runner always uses the development key, never the configured distribution signing profile.
    $env:FOLIO_ANDROID_KEYSTORE = Join-Path $ToolsRoot 'folio-development.keystore'
    $env:FOLIO_ANDROID_STORE_PASSWORD = 'android'
    $env:FOLIO_ANDROID_KEY_ALIAS = 'androiddebugkey'
    $env:FOLIO_ANDROID_KEY_PASSWORD = 'android'
    if (-not (Test-Path -LiteralPath $env:FOLIO_ANDROID_KEYSTORE)) { throw 'Development keystore missing; run scripts/build-android.ps1 once without a release profile.' }
    if (-not $SkipBuild) {
        Push-Location $projectRoot
        try {
            & node scripts/prepare-android-assets.mjs
            if ($LASTEXITCODE) { throw 'Android asset preparation failed.' }
            & $gradle -p android --no-daemon :app:assembleRelease :app:assembleReleaseAndroidTest 2>&1 | Tee-Object (Join-Path $OutputDirectory 'build.log')
            if ($LASTEXITCODE) { throw 'Instrumentation APK build failed.' }
        } finally { Pop-Location }
        Copy-Item (Join-Path $projectRoot 'android/app/build/outputs/apk/release/app-release.apk') (Join-Path $OutputDirectory 'app-development.apk') -Force
        Copy-Item (Join-Path $projectRoot 'android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk') (Join-Path $OutputDirectory 'app-development-androidTest.apk') -Force
    }
    foreach ($apk in @('app-development.apk','app-development-androidTest.apk')) {
        & $adb -s $Serial install -r (Join-Path $OutputDirectory $apk)
        if ($LASTEXITCODE) { throw "Cannot install $apk on $Serial. Resolve a signature mismatch only on this dedicated test AVD; this script does not remove app data." }
    }
    $instrumentArgs = @()
    if ($IncludePdfImport) {
        & $adb -s $Serial push (Join-Path $projectRoot 'examples/simple.pdf') /sdcard/Download/folio-native-input.pdf
        if ($LASTEXITCODE) { throw 'Cannot stage the native PDF picker fixture.' }
        # adb push preserves the source mtime; make this test fixture visible at the top of Downloads.
        & $adb -s $Serial shell touch /sdcard/Download/folio-native-input.pdf
        if ($LASTEXITCODE) { throw 'Cannot timestamp the native PDF picker fixture.' }
        & $adb -s $Serial shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Download/folio-native-input.pdf
        if ($LASTEXITCODE) { throw 'Cannot index the native PDF picker fixture.' }
        $instrumentArgs = @('-e','importPdf','1')
    }
    $log = Join-Path $OutputDirectory 'instrumentation.log'
    $errorLog = Join-Path $OutputDirectory 'instrumentation-stderr.log'
    $processArgs = @('-s',$Serial,'shell','am','instrument','-r','-w') + $instrumentArgs + @('app.folio.offline.test/app.folio.offline.RuntimeSmoke')
    $instrumentation = Start-Process -FilePath $adb -ArgumentList $processArgs -PassThru -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $errorLog
    if (-not $instrumentation.WaitForExit(180000)) {
        Stop-Process -Id $instrumentation.Id -ErrorAction SilentlyContinue
        Get-Content -LiteralPath $log
        throw "Native runtime acceptance timed out after 180 seconds; inspect $log and $errorLog. The app may still be running on $Serial."
    }
    $adbExit = $instrumentation.ExitCode
    Get-Content -LiteralPath $log
    $stream = Get-Content -LiteralPath $log -Raw
    # am instrument can exit 0 while its stream reports FAIL or a crashed runner.
    if ($adbExit -ne 0 -or $stream -notmatch '(?m)^PASS: Folio RuntimeSmoke\r?$' -or
        $stream -notmatch '(?m)^INSTRUMENTATION_CODE: -1\r?$' -or
        $stream -match '(?im)((^|stream=)FAIL:|INSTRUMENTATION_FAILED|INSTRUMENTATION_ABORTED|shortMsg=|Process crashed)') {
        throw "Native runtime acceptance failed. Inspect JS and instrumentation evidence: $log"
    }
    if ($IncludePdfImport -and $stream -notmatch '(?m)^SAF_PDF_IMPORT PASS folio-native-input.pdf\r?$') { throw "PDF import assertion missing: $log" }
    Write-Output "Native runtime acceptance PASS. Evidence: $log"
} finally {
    foreach ($name in $signingNames) { [Environment]::SetEnvironmentVariable($name,$previousSigning[$name],'Process') }
}
