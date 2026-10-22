param(
    [string]$KeyDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) '../.folio-signing')
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$KeyDirectory = [IO.Path]::GetFullPath($KeyDirectory)
if ($KeyDirectory.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or $KeyDirectory -eq $repo) {
    throw 'Signing keys must be stored outside the repository.'
}
$profile = Join-Path $KeyDirectory 'signing-profile.json'
$keystore = Join-Path $KeyDirectory 'folio-release.p12'
if ((Test-Path $profile) -or (Test-Path $keystore)) { throw 'Signing material already exists. Refusing to replace it.' }
$keytool = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin/keytool.exe' } else { (Get-Command keytool.exe -ErrorAction Stop).Source }
New-Item -ItemType Directory -Force $KeyDirectory | Out-Null
$random = [byte[]]::new(48)
[Security.Cryptography.RandomNumberGenerator]::Fill($random)
$password = [Convert]::ToBase64String($random)
$previous = $env:FOLIO_SIGNING_PASSWORD
try {
    $protected = ConvertTo-SecureString -String $password -AsPlainText -Force | ConvertFrom-SecureString
    $env:FOLIO_SIGNING_PASSWORD = $password
    & $keytool -genkeypair -keystore $keystore -storetype PKCS12 -storepass:env FOLIO_SIGNING_PASSWORD -keypass:env FOLIO_SIGNING_PASSWORD -alias folio-release -keyalg RSA -keysize 3072 -sigalg SHA256withRSA -validity 10000 -dname 'CN=Folio Android Release, O=Folio, C=CN'
    if ($LASTEXITCODE) { throw 'Signing key generation failed.' }
    @{keystore=$keystore;alias='folio-release';protectedPassword=$protected} | ConvertTo-Json | Set-Content -LiteralPath $profile -Encoding utf8
    & $keytool -exportcert -rfc -keystore $keystore -storepass:env FOLIO_SIGNING_PASSWORD -alias folio-release -file (Join-Path $KeyDirectory 'folio-android-release.pem')
    if ($LASTEXITCODE) { throw 'Public certificate export failed.' }
    Write-Output "Signing profile: $profile"
    Write-Output 'The password is encrypted with Windows DPAPI for the current account. Back up the keystore and password separately before moving machines; see docs/signing.md.'
} finally {
    $env:FOLIO_SIGNING_PASSWORD = $previous
    $password = $null
    [Array]::Clear($random,0,$random.Length)
}
