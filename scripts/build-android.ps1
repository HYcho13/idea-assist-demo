param([switch]$Install, [string]$Device = 'emulator-5554')

$ErrorActionPreference = 'Stop'
$demoProjectRoot = Split-Path -Parent $PSScriptRoot
$demoAndroidRoot = Join-Path $demoProjectRoot 'android'
$demoSdk = $env:ANDROID_HOME
if (-not $demoSdk) { $demoSdk = $env:ANDROID_SDK_ROOT }
if (-not $demoSdk) { $demoSdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path -LiteralPath $demoSdk)) { throw 'Install Android Studio and its SDK first.' }
$demoJdk = $env:JAVA_HOME
if (-not $demoJdk) { $demoJdk = Join-Path $env:ProgramFiles 'Android\Android Studio\jbr' }
if (-not (Test-Path -LiteralPath (Join-Path $demoJdk 'bin\java.exe'))) {
    throw 'Set JAVA_HOME to Android Studio JBR or a supported JDK.'
}
$demoOriginalJava = $env:JAVA_HOME
$demoOriginalSdk = $env:ANDROID_HOME
$demoBuildRoot = $demoAndroidRoot
if ($demoAndroidRoot -match '[^\x00-\x7F]') {
    # Windows CMake can fail in non-ASCII directories. A stable alias avoids moving user files.
    $demoHash = [Security.Cryptography.SHA256]::Create()
    try { $demoSuffix = -join ($demoHash.ComputeHash([Text.Encoding]::UTF8.GetBytes($demoAndroidRoot)) | ForEach-Object { $_.ToString('x2') }) }
    finally { $demoHash.Dispose() }
    $demoBuildRoot = Join-Path ([IO.Path]::GetTempPath()) ('idea-assist-android-' + $demoSuffix.Substring(0,12))
    if ($demoBuildRoot -match '[^\x00-\x7F]') { throw 'Use an ASCII project path or an ASCII TEMP directory for the Android native build.' }
    if (Test-Path -LiteralPath $demoBuildRoot) {
        $demoAlias = Get-Item -LiteralPath $demoBuildRoot -Force
        if (-not ($demoAlias.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
            @($demoAlias.Target)[0] -ne $demoAndroidRoot) {
            throw 'The temporary Android build alias belongs to a different target. No files were changed.'
        }
    } else {
        New-Item -ItemType Junction -Path $demoBuildRoot -Target $demoAndroidRoot | Out-Null
    }
    Write-Host ('Using reusable ASCII build alias: ' + $demoBuildRoot)
}
try {
    $env:JAVA_HOME = $demoJdk
    $env:ANDROID_HOME = $demoSdk
    Push-Location -LiteralPath $demoBuildRoot
    try {
        & .\gradlew.bat assembleDebug --console=plain
        if ($LASTEXITCODE -ne 0) { throw 'Android build failed. Check SDK 36, NDK 28.2.13676358, and CMake 3.22.1.' }
        $demoApk = Join-Path $demoAndroidRoot 'app\build\outputs\apk\debug\app-debug.apk'
        Write-Host ('APK: ' + $demoApk)
        if ($Install) {
            $demoAdb = Join-Path $demoSdk 'platform-tools\adb.exe'
            & $demoAdb -s $Device get-state
            if ($LASTEXITCODE -ne 0) { throw 'Start your emulator in Android Studio first, or select -Device.' }
            & $demoAdb -s $Device install -r $demoApk
            if ($LASTEXITCODE -ne 0) { throw 'APK installation failed.' }
            & $demoAdb -s $Device shell am start -n 'com.ideaassist.app/.MainActivity'
            if ($LASTEXITCODE -ne 0) { throw 'App launch failed.' }
        }
    } finally { Pop-Location }
} finally {
    $env:JAVA_HOME = $demoOriginalJava
    $env:ANDROID_HOME = $demoOriginalSdk
}
