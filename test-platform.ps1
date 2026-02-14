# Quick Test Script - Test all 3 layers
# Usage: .\test-platform.ps1
# Note: Flow tools are integrated into BCGPT (no separate server)

Write-Host "=== BCGPT 3-Layer Platform Test ===`n" -ForegroundColor Cyan

$baseUrlBCGPT = "http://localhost:10000"
$baseUrlPMOS = "http://localhost:10001"

function Test-Endpoint {
    param($url, $name)
    try {
        $response = Invoke-RestMethod -Uri $url -Method Get -ErrorAction Stop
        Write-Host "✓ $name" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "✗ $name - $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

function Test-MCP {
    param($url, $name)
    try {
        $body = @{
            jsonrpc = "2.0"
            id = 1
            method = "tools/list"
        } | ConvertTo-Json
        
        $response = Invoke-RestMethod -Uri "$url/mcp" -Method Post -Body $body -ContentType "application/json" -ErrorAction Stop
        $toolCount = $response.result.tools.Count
        Write-Host "✓ $name MCP ($toolCount tools)" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "✗ $name MCP - $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

function Test-Gateway {
    param($toolName)
    try {
        $body = @{
            jsonrpc = "2.0"
            id = 1
            method = "tools/call"
            params = @{
                name = $toolName
                arguments = @{}
            }
        } | ConvertTo-Json
        
        $response = Invoke-RestMethod -Uri "$baseUrlBCGPT/mcp" -Method Post -Body $body -ContentType "application/json" -ErrorAction Stop
        Write-Host "✓ Gateway routing: $toolName" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "✗ Gateway routing: $toolName - $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

Write-Host "1. Testing Health Endpoints...`n" -ForegroundColor Yellow
$bcgptHealth = Test-Endpoint "$baseUrlBCGPT/health" "BCGPT Health"
$pmosHealth = Test-Endpoint "$baseUrlPMOS/health" "PMOS Health"

Write-Host "`n2. Testing MCP Protocol...`n" -ForegroundColor Yellow
$bcgptMCP = Test-MCP $baseUrlBCGPT "BCGPT (includes Flow tools)"
$pmosMCP = Test-MCP $baseUrlPMOS "PMOS"

Write-Host "`n3. Testing Gateway Routing...`n" -ForegroundColor Yellow
$pmosGateway = Test-Gateway "pmos_status"

Write-Host "`n4. Testing Flow Tools (Local in BCGPT)...`n" -ForegroundColor Yellow
$flowStatus = Test-Gateway "flow_status"

Write-Host "`n=== Test Summary ===`n" -ForegroundColor Cyan

$totalTests = 6
$passedTests = 0
if ($bcgptHealth) { $passedTests++ }
if ($pmosHealth) { $passedTests++ }
if ($bcgptMCP) { $passedTests++ }
if ($pmosMCP) { $passedTests++ }
if ($pmosGateway) { $passedTests++ }
if ($flowStatus) { $passedTests++ }

Write-Host "Passed: $passedTests / $totalTests" -ForegroundColor $(if ($passedTests -eq $totalTests) { "Green" } else { "Yellow" })

if ($passedTests -eq $totalTests) {
    Write-Host "`n🎉 All tests passed! Platform is fully operational." -ForegroundColor Green
} else {
    Write-Host "`n⚠️  Some tests failed. Check server logs for details." -ForegroundColor Yellow
}

Write-Host "`nEndpoints:" -ForegroundColor Gray
Write-Host "  BCGPT (with Flow): $baseUrlBCGPT" -ForegroundColor Gray
Write-Host "  PMOS:             $baseUrlPMOS" -ForegroundColor Gray
Write-Host "  Activepieces:     flow.wickedlab.io`n" -ForegroundColor Gray
