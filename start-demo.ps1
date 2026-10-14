$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$demoUrl = 'http://127.0.0.1:5180/'
try {
    $demoResponse = Invoke-WebRequest -Uri $demoUrl -UseBasicParsing -TimeoutSec 2
    if ($demoResponse.Content -match '/src/demo-main.jsx') {
        Start-Process $demoUrl
        Write-Host 'The demo is already running. Opened the browser.'
        exit 0
    }
} catch { }
$demoPnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
if (-not $demoPnpm) { throw 'Node.js and pnpm are required. See README.md.' }
if (-not (Test-Path -LiteralPath 'node_modules/@mlc-ai/web-llm')) {
    & $demoPnpm.Source install
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
Write-Host 'Open this URL when Vite is ready: http://127.0.0.1:5180/'
Write-Host 'Keep this window open during the demo. Press Ctrl+C to stop.'
& $demoPnpm.Source dev
