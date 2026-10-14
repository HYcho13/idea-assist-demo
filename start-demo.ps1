param([switch]$InstallOnly)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$demoUrl = 'http://127.0.0.1:5180/'
$demoNode = Get-Command node -ErrorAction SilentlyContinue
$demoNpm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $demoNode -or -not $demoNpm) {
    throw 'Install Node.js 24 LTS (with npm), reopen this window, and try again. See README.md.'
}
$demoNodeVersion = [version]((& $demoNode.Source --version).Trim().TrimStart('v'))
if ($demoNodeVersion -lt [version]'22.13.0') {
    throw 'Node.js 22.13.0 or newer is required. Node.js 24 LTS is recommended.'
}

# npm obtains the exact pnpm version; no global pnpm installation is required.
& $demoNpm.Source exec --yes --package=pnpm@11.25.0 -- pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check your internet connection.' }
if ($InstallOnly) {
    Write-Host 'Dependencies are ready. No API key, API server, or database is required.'
    exit 0
}

try {
    $demoResponse = Invoke-WebRequest -Uri $demoUrl -UseBasicParsing -TimeoutSec 2
    if ($demoResponse.Content -match '/src/demo-main.jsx') {
        Start-Process $demoUrl
        Write-Host 'The demo is already running. Opened the browser.'
        exit 0
    }
} catch { }
Write-Host 'Open this URL when Vite is ready: http://127.0.0.1:5180/'
Write-Host 'Keep this window open during the demo. Press Ctrl+C to stop.'
& $demoNpm.Source exec --yes --package=pnpm@11.25.0 -- pnpm dev
if ($LASTEXITCODE -ne 0) {
    throw 'Could not start the demo. If port 5180 is occupied, close the other app using it and try again.'
}
