# Start all 3 BCGPT layers
# Usage: .\start-all.ps1

Write-Host @"
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║             BCGPT 3-Layer Platform Startup                ║
║                                                           ║
║   Starting all 3 layers:                                  ║
║   - BCGPT (Data Layer) on port 10000                      ║
║   - PMOS (Intelligence Layer) on port 10001               ║
║   - Flow (Execution Layer) on port 10002                  ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
"@ -ForegroundColor Cyan

# Check if Node.js is installed
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Node.js is not installed. Please install Node.js 18+ first." -ForegroundColor Red
    exit 1
}

Write-Host "`n📦 Checking dependencies...`n" -ForegroundColor Yellow

# Start BCGPT (Data Layer)
Write-Host "🔷 Starting BCGPT (Data Layer)..." -ForegroundColor Blue
Push-Location $PSScriptRoot
if (-not (Test-Path "node_modules")) {
    Write-Host "   Installing BCGPT dependencies..." -ForegroundColor Gray
    npm install --silent
}
$bcgptJob = Start-Process -FilePath "node" -ArgumentList "index.js" -WorkingDirectory $PSScriptRoot -PassThru -WindowStyle Minimized
Start-Sleep -Seconds 3
Write-Host "   ✓ BCGPT started (PID: $($bcgptJob.Id))" -ForegroundColor Green
Pop-Location

# Start PMOS (Intelligence Layer)
Write-Host "🧠 Starting PMOS (Intelligence Layer)..." -ForegroundColor Blue
Push-Location "$PSScriptRoot\pmos-server"
if (-not (Test-Path "node_modules")) {
    Write-Host "   Installing PMOS dependencies..." -ForegroundColor Gray
    npm install --silent
}
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "   Created .env from .env.example" -ForegroundColor Gray
}
$pmosJob = Start-Process -FilePath "node" -ArgumentList "index.js" -WorkingDirectory "$PSScriptRoot\pmos-server" -PassThru -WindowStyle Minimized
Start-Sleep -Seconds 2
Write-Host "   ✓ PMOS started (PID: $($pmosJob.Id))" -ForegroundColor Green
Pop-Location

# Start Flow (Execution Layer)
Write-Host "⚡ Starting Flow (Execution Layer)..." -ForegroundColor Blue
Push-Location "$PSScriptRoot\flow-server"
if (-not (Test-Path "node_modules")) {
    Write-Host "   Installing Flow dependencies..." -ForegroundColor Gray
    npm install --silent
}
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "   Created .env from .env.example - CONFIGURE ACTIVEPIECES_API_KEY!" -ForegroundColor Yellow
}
$flowJob = Start-Process -FilePath "node" -ArgumentList "index.js" -WorkingDirectory "$PSScriptRoot\flow-server" -PassThru -WindowStyle Minimized
Start-Sleep -Seconds 2
Write-Host "   ✓ Flow started (PID: $($flowJob.Id))" -ForegroundColor Green
Pop-Location

Write-Host @"

╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   ✓ All 3 layers are running!                            ║
║                                                           ║
║   BCGPT:  http://localhost:10000                          ║
║   PMOS:   http://localhost:10001                          ║
║   Flow:   http://localhost:10002                          ║
║                                                           ║
║   MCP Endpoints:                                          ║
║   - http://localhost:10000/mcp (BCGPT + Gateway)          ║
║   - http://localhost:10001/mcp (PMOS)                     ║
║   - http://localhost:10002/mcp (Flow)                     ║
║                                                           ║
║   Health Checks:                                          ║
║   - http://localhost:10000/health                         ║
║   - http://localhost:10001/health                         ║
║   - http://localhost:10002/health                         ║
║                                                           ║
║   Press Ctrl+C to stop all servers                        ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝

"@ -ForegroundColor Cyan

Write-Host "📊 Server Process IDs:" -ForegroundColor Yellow
Write-Host "   BCGPT: $($bcgptJob.Id)" -ForegroundColor Gray
Write-Host "   PMOS:  $($pmosJob.Id)" -ForegroundColor Gray
Write-Host "   Flow:  $($flowJob.Id)" -ForegroundColor Gray

Write-Host "`n💡 Tip: Run 'Get-Process -Id $($bcgptJob.Id),$($pmosJob.Id),$($flowJob.Id)' to check status" -ForegroundColor Yellow
Write-Host "💡 Tip: Run 'Stop-Process -Id $($bcgptJob.Id),$($pmosJob.Id),$($flowJob.Id)' to stop all servers`n" -ForegroundColor Yellow

# Keep script running
Write-Host "Monitoring servers... Press Ctrl+C to stop all and exit.`n" -ForegroundColor Gray

try {
    while ($true) {
        Start-Sleep -Seconds 5
        
        # Check if any process has died
        $allRunning = $true
        if (-not (Get-Process -Id $bcgptJob.Id -ErrorAction SilentlyContinue)) {
            Write-Host "❌ BCGPT process stopped!" -ForegroundColor Red
            $allRunning = $false
        }
        if (-not (Get-Process -Id $pmosJob.Id -ErrorAction SilentlyContinue)) {
            Write-Host "❌ PMOS process stopped!" -ForegroundColor Red
            $allRunning = $false
        }
        if (-not (Get-Process -Id $flowJob.Id -ErrorAction SilentlyContinue)) {
            Write-Host "❌ Flow process stopped!" -ForegroundColor Red
            $allRunning = $false
        }
        
        if (-not $allRunning) {
            Write-Host "`nStopping remaining servers..." -ForegroundColor Yellow
            Stop-Process -Id $bcgptJob.Id -ErrorAction SilentlyContinue
            Stop-Process -Id $pmosJob.Id -ErrorAction SilentlyContinue
            Stop-Process -Id $flowJob.Id -ErrorAction SilentlyContinue
            break
        }
    }
} finally {
    Write-Host "`nCleaning up..." -ForegroundColor Yellow
    Stop-Process -Id $bcgptJob.Id -ErrorAction SilentlyContinue
    Stop-Process -Id $pmosJob.Id -ErrorAction SilentlyContinue
    Stop-Process -Id $flowJob.Id -ErrorAction SilentlyContinue
    Write-Host "✓ All servers stopped." -ForegroundColor Green
}
