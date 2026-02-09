# BCGPT + Basecamp Integration Test Script
# Tests critical endpoints against the BCGPT TEST PROJECT (45925981)

$apiKey = "0ac92268b7f18b61767d9a3754342641b2f47b1c8baa80b3"
$testProjectId = 45925981
$baseUrl = "https://bcgpt.wickedlab.io"

$common_headers = @{
    "x-bcgpt-api-key" = $apiKey
    "Content-Type" = "application/json"
}

Write-Host "=== BCGPT Basecamp Integration Test ===" -ForegroundColor Cyan
Write-Host "Test Project: $testProjectId" -ForegroundColor Yellow
Write-Host ""

# Test 1: List Projects
Write-Host "1. Testing list_projects..." -ForegroundColor Green
try {
    $response = Invoke-WebRequest -Uri "$baseUrl/action/run" `
        -Method Post `
        -Headers $common_headers `
        -Body '{"action":"list_projects","params":{}}' `
        -UseBasicParsing

    $data = $response.Content | ConvertFrom-Json
    $testProject = $data.result | Where-Object { $_.id -eq $testProjectId }
    
    if ($testProject) {
        Write-Host "✓ Test project found: $($testProject.name)" -ForegroundColor Green
    } else {
        Write-Host "✗ Test project not found" -ForegroundColor Red
    }
} catch {
    Write-Host "✗ Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# Test 2: Get Project Structure
Write-Host "2. Testing get_project_structure..." -ForegroundColor Green
try {
    $body = @{
        action = "get_project_structure"
        params = @{
            project_id = $testProjectId
        }
    } | ConvertTo-Json
    
    $response = Invoke-WebRequest -Uri "$baseUrl/action/run" `
        -Method Post `
        -Headers $common_headers `
        -Body $body `
        -UseBasicParsing
    
    $data = $response.Content | ConvertFrom-Json
    if ($data.result) {
        Write-Host "✓ Project structure retrieved" -ForegroundColor Green
        Write-Host "  - Dock items: $(($data.result.dock | Measure-Object).Count)" -ForegroundColor Gray
    } else {
        Write-Host "✗ No result returned" -ForegroundColor Red
    }
} catch {
    Write-Host "✗ Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# Test 3: List Todolists
Write-Host "3. Testing list_todolists..." -ForegroundColor Green
try {
    $body = @{
        action = "list_todolists"
        params = @{
            project_id = $testProjectId
        }
    } | ConvertTo-Json
    
    $response = Invoke-WebRequest -Uri "$baseUrl/action/run" `
        -Method Post `
        -Headers $common_headers `
        -Body $body `
        -UseBasicParsing
    
    $data = $response.Content | ConvertFrom-Json
    $count = ($data.result | Measure-Object).Count
    if ($count -ge 0) {
        Write-Host "✓ Found $count todolists" -ForegroundColor Green
        if ($count -gt 0) {
            $data.result | Select-Object -First 3 | ForEach-Object {
                Write-Host "  - $($_.title)" -ForegroundColor Gray
            }
        }
    } else {
        Write-Host "✗ Invalid response" -ForegroundColor Red
    }
} catch {
    Write-Host "✗ Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# Test 4: List People
Write-Host "4. Testing list_project_people..." -ForegroundColor Green
try {
    $body = @{
        action = "list_project_people"
        params = @{
            project_id = $testProjectId
        }
    } | ConvertTo-Json
    
    $response = Invoke-WebRequest -Uri "$baseUrl/action/run" `
        -Method Post `
        -Headers $common_headers `
        -Body $body `
        -UseBasicParsing
    
    $data = $response.Content | ConvertFrom-Json
    $count = ($data.result | Measure-Object).Count
    Write-Host "✓ Found $count team members" -ForegroundColor Green
    if ($count -gt 0) {
        $data.result | Select-Object -First 3 | ForEach-Object {
            Write-Host "  - $($_.name) ($($_.email_address))" -ForegroundColor Gray
        }
    }
} catch {
    Write-Host "✗ Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Test Complete ===" -ForegroundColor Cyan

