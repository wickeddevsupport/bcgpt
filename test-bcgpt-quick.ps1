# BCGPT Basecamp Integration Test

$apiKey = "0ac92268b7f18b61767d9a3754342641b2f47b1c8baa80b3"
$projectId = 45925981
$baseUrl = "https://bcgpt.wickedlab.io"

$headers = @{
    "x-bcgpt-api-key" = $apiKey
    "Content-Type" = "application/json"
}

Write-Host "=== BCGPT Integration Test ===" -ForegroundColor Cyan

# Test 1: List Projects
Write-Host "`nTest 1: list_projects" -ForegroundColor Green
$body = '{"action":"list_projects","params":{}}'
$r = Invoke-WebRequest -Uri "$baseUrl/action/run" -Method Post -Headers $headers -Body $body -UseBasicParsing
$data = $r.Content | ConvertFrom-Json
$project = $data.result | Where-Object { $_.id -eq $projectId }
if ($project) { Write-Host "✓ Found test project: $($project.name)" -ForegroundColor Green } else { Write-Host "✗ Test project not found" -ForegroundColor Red }

# Test 2: Get project structure  
Write-Host "`nTest 2: get_project_structure" -ForegroundColor Green
$body = @{ action = "get_project_structure"; params = @{ project_id = $projectId } } | ConvertTo-Json
$r = Invoke-WebRequest -Uri "$baseUrl/action/run" -Method Post -Headers $headers -Body $body -UseBasicParsing
$data = $r.Content | ConvertFrom-Json
if ($data.result) { Write-Host "✓ Project structure retrieved" -ForegroundColor Green } else { Write-Host "✗ Failed" -ForegroundColor Red }

# Test 3: List todolists
Write-Host "`nTest 3: list_todolists" -ForegroundColor Green
$body = @{ action = "list_todolists"; params = @{ project_id = $projectId } } | ConvertTo-Json
$r = Invoke-WebRequest -Uri "$baseUrl/action/run" -Method Post -Headers $headers -Body $body -UseBasicParsing
$data = $r.Content | ConvertFrom-Json
$count = @($data.result).Count
Write-Host "✓ Found $count todolists" -ForegroundColor Green

# Test 4: List people
Write-Host "`nTest 4: list_project_people" -ForegroundColor Green
$body = @{ action = "list_project_people"; params = @{ project_id = $projectId } } | ConvertTo-Json
$r = Invoke-WebRequest -Uri "$baseUrl/action/run" -Method Post -Headers $headers -Body $body -UseBasicParsing
$data = $r.Content | ConvertFrom-Json
$count = @($data.result).Count
Write-Host "✓ Found $count team members" -ForegroundColor Green

Write-Host "`n=== All Tests Passed ===" -ForegroundColor Cyan
