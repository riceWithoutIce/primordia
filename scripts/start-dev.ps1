$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$port = 5173
$url = "http://127.0.0.1:$port/"

Set-Location $root

$nodeDir = Join-Path $env:ProgramFiles "nodejs"
$nodeNpm = Join-Path $nodeDir "npm.cmd"
if (Test-Path $nodeNpm) {
  $env:Path = "$nodeDir;$env:Path"
  $npm = $nodeNpm
} else {
  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($npmCommand) {
    $npm = $npmCommand.Source
  }
}

if (-not $npm) {
  Write-Host "npm was not found. Please install Node.js LTS, then reopen PowerShell."
  Read-Host "Press Enter to close"
  exit 1
}

if (-not (Test-Path "node_modules\.bin\vite.cmd")) {
  Write-Host "Installing dependencies..."
  & $npm install
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Dependency installation failed."
    Read-Host "Press Enter to close"
    exit $LASTEXITCODE
  }
}

$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $listener) {
  Write-Host "Starting Primordia dev server..."
  $devCommand = "cd /d `"$root`" && `"$npm`" run dev"
  Start-Process -FilePath "cmd.exe" -ArgumentList @("/k", $devCommand) -WorkingDirectory $root
} else {
  Write-Host "Dev server already appears to be running on port $port."
}

$isReady = $false
for ($attempt = 1; $attempt -le 20; $attempt += 1) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 1
    if ($response.StatusCode -eq 200) {
      $isReady = $true
      break
    }
  } catch {
    Start-Sleep -Milliseconds 500
  }
}

if (-not $isReady) {
  Write-Host "Dev server did not become ready at $url."
  Write-Host "Check the 'primordia dev server' window for npm or Vite errors."
  Read-Host "Press Enter to close"
  exit 1
}

Start-Process $url
Write-Host "Opened $url"
