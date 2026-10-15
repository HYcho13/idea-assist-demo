param(
    [Parameter(Mandatory = $true)][string]$SourceRoot,
    [Parameter(Mandatory = $true)][string]$OutputRoot,
    [Parameter(Mandatory = $true)][string]$SdkRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$nativeSource = [IO.Path]::GetFullPath($SourceRoot)
$nativeOutput = [IO.Path]::GetFullPath($OutputRoot)
$nativeSdk = [IO.Path]::GetFullPath($SdkRoot)
$nativePin = '091b6a7fc561b78da90a0ed2d524ec995458c657'
$nativeNdk = Join-Path $nativeSdk 'ndk\28.2.13676358'
$nativeCmake = Join-Path $nativeSdk 'cmake\3.22.1\bin\cmake.exe'
$nativeNinja = Join-Path $nativeSdk 'cmake\3.22.1\bin\ninja.exe'
$nativeToolchain = Join-Path $nativeNdk 'build\cmake\android.toolchain.cmake'
$nativeSysroot = Join-Path $nativeNdk 'toolchains\llvm\prebuilt\windows-x86_64\sysroot'
foreach ($required in @((Join-Path $nativeSource 'CMakeLists.txt'), $nativeCmake, $nativeNinja, $nativeToolchain)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Missing native build dependency: $required" }
}

$nativeHash = [Security.Cryptography.SHA256]::Create()
try {
    $nativeFingerprint = $nativeSource.ToLowerInvariant() + '|' + $nativeSdk.ToLowerInvariant() + '|ndk28.2-v1'
    $nativeSuffix = -join ($nativeHash.ComputeHash([Text.Encoding]::UTF8.GetBytes($nativeFingerprint)) |
        ForEach-Object { $_.ToString('x2') })
} finally { $nativeHash.Dispose() }
$nativeCacheBase = [IO.Path]::GetTempPath()
if ($nativeCacheBase -match '[^\x00-\x7F]') {
    # A Unicode Windows username can also make TEMP unsuitable for CMake.
    $nativeCacheBase = Join-Path $env:PUBLIC 'Documents\IdeaAssistNativeCache'
}
if ($nativeCacheBase -match '[^\x00-\x7F]') { throw 'Set TEMP to a writable ASCII path for the native build.' }
$nativeCache = Join-Path $nativeCacheBase ('ideaassist-native-' + $nativeSuffix.Substring(0, 16))
New-Item -ItemType Directory -Path $nativeCache -Force | Out-Null

function Ensure-NativeJunction([string]$Path, [string]$Target) {
    if (Test-Path -LiteralPath $Path) {
        $link = Get-Item -LiteralPath $Path -Force
        if ($link.LinkType -ne 'Junction' -or
            -not [string]::Equals([string]@($link.Target)[0], $Target, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Native cache junction has a different target: $Path. No existing files were removed."
        }
    } else {
        New-Item -ItemType Junction -Path $Path -Target $Target | Out-Null
    }
}

# Serialize builds sharing the same cache (for example Android Studio and a terminal).
$nativeLock = $null
$nativeDeadline = [DateTime]::UtcNow.AddMinutes(5)
while ($null -eq $nativeLock) {
    try {
        $nativeLock = [IO.File]::Open((Join-Path $nativeCache 'build.lock'),
            [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    } catch [IO.IOException] {
        if ([DateTime]::UtcNow -gt $nativeDeadline) { throw 'Another native build is still using the ASCII cache.' }
        Start-Sleep -Milliseconds 500
    }
}
try {
    $nativeAlias = Join-Path $nativeCache 'source'
    Ensure-NativeJunction $nativeAlias $nativeSource
    Write-Host "Native build ASCII cache: $nativeCache"
    Push-Location -LiteralPath $nativeCache
    try {
        # This is optional: fresh checkouts use CMake's pinned, SHA-256-verified
        # FetchContent URL. Reuse only an official-pin checkout with no edits.
        $nativeVendor = [IO.Path]::GetFullPath((Join-Path $nativeSource '..\..\..\..\vendor\llama.cpp'))
        $nativeVendorArg = $null
        $nativeGit = Get-Command git.exe -ErrorAction SilentlyContinue
        if ($nativeGit -and (Test-Path -LiteralPath (Join-Path $nativeVendor '.git'))) {
            $nativeRevision = & $nativeGit.Source -C $nativeVendor rev-parse HEAD 2>$null
            $nativeGitOk = $LASTEXITCODE -eq 0
            $nativeChanges = & $nativeGit.Source -C $nativeVendor status --porcelain 2>$null
            if ($nativeGitOk -and $LASTEXITCODE -eq 0 -and $nativeRevision -eq $nativePin -and -not $nativeChanges) {
                $nativeVendorAlias = Join-Path $nativeCache 'llama'
                Ensure-NativeJunction $nativeVendorAlias $nativeVendor
                $nativeVendorArg = '-DFETCHCONTENT_SOURCE_DIR_LLAMA=' + $nativeVendorAlias.Replace('\', '/')
                Write-Host "Using verified llama.cpp checkout: $nativePin"
            }
        }
        $nativeAbis = @(
            @{ Abi = 'x86_64'; Triple = 'x86_64-linux-android' },
            @{ Abi = 'arm64-v8a'; Triple = 'aarch64-linux-android' }
        )
        foreach ($entry in $nativeAbis) {
            # Separate caches prevent accidental toolchain/ABI mixing.
            $nativeBuild = Join-Path $nativeCache ('build-' + $entry.Abi)
            $nativeArgs = @('-S', $nativeAlias, '-B', $nativeBuild, '-G', 'Ninja',
                ('-DCMAKE_MAKE_PROGRAM=' + $nativeNinja.Replace('\', '/')),
                ('-DCMAKE_TOOLCHAIN_FILE=' + $nativeToolchain.Replace('\', '/')),
                ('-DANDROID_ABI=' + $entry.Abi), '-DANDROID_PLATFORM=android-26',
                '-DANDROID_STL=c++_shared', '-DCMAKE_BUILD_TYPE=Release',
                ('-DFETCHCONTENT_BASE_DIR=' + (Join-Path $nativeCache ('deps-' + $entry.Abi)).Replace('\', '/')),
                # Clear a previous source override when vendor reuse is unavailable.
                '-DFETCHCONTENT_SOURCE_DIR_LLAMA=')
            if ($nativeVendorArg) { $nativeArgs += $nativeVendorArg }
            & $nativeCmake @nativeArgs
            if ($LASTEXITCODE -ne 0) { throw "CMake configuration failed for $($entry.Abi)" }
            & $nativeCmake --build $nativeBuild --target idea_llm -j 6
            if ($LASTEXITCODE -ne 0) { throw "JNI compilation failed for $($entry.Abi)" }
            $nativeLibrary = Join-Path $nativeBuild 'libidea_llm.so'
            $nativeRuntime = Join-Path $nativeSysroot ('usr\lib\' + $entry.Triple + '\libc++_shared.so')
            foreach ($library in @($nativeLibrary, $nativeRuntime)) {
                if (-not (Test-Path -LiteralPath $library -PathType Leaf)) { throw "Missing native output: $library" }
            }
            $nativeDestination = Join-Path $nativeOutput $entry.Abi
            New-Item -ItemType Directory -Path $nativeDestination -Force | Out-Null
            Copy-Item -LiteralPath $nativeLibrary -Destination (Join-Path $nativeDestination 'libidea_llm.so') -Force
            Copy-Item -LiteralPath $nativeRuntime -Destination (Join-Path $nativeDestination 'libc++_shared.so') -Force
            Write-Host "JNI libraries ready: $nativeDestination"
        }
    } finally { Pop-Location }
} finally { $nativeLock.Dispose() }
