param(
  [string]$WebUrl = "https://www.boyzweekend.org",
  [string]$AdminUrl = "https://www.boyzweekend.org/admin",
  [string]$ApiHealthUrl = "https://api.boyzweekend.org/api/health"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-UrlCheck {
  param(
    [string]$Name,
    [string]$Uri,
    [int]$ExpectedStatus = 200
  )

  try {
    $response = Invoke-WebRequest -Method Get -Uri $Uri
  }
  catch {
    throw "$Name check failed at $Uri. $($_.Exception.Message)"
  }

  if ($response.StatusCode -ne $ExpectedStatus) {
    throw "$Name check failed at $Uri. Expected status $ExpectedStatus, got $($response.StatusCode)."
  }

  return $response
}

Write-Host "Running synthetic checks..." -ForegroundColor Cyan

$webResponse = Invoke-UrlCheck -Name "Web root" -Uri $WebUrl
$adminResponse = Invoke-UrlCheck -Name "Admin route" -Uri $AdminUrl

try {
  $health = Invoke-RestMethod -Method Get -Uri $ApiHealthUrl
}
catch {
  throw "API health check failed at $ApiHealthUrl. $($_.Exception.Message)"
}

if (-not [bool]$health.ok) {
  throw "API health endpoint did not return ok=true."
}

$result = [PSCustomObject]@{
  WebStatusCode   = $webResponse.StatusCode
  AdminStatusCode = $adminResponse.StatusCode
  ApiHealthOk     = [bool]$health.ok
  Service         = $health.service
  CheckedAtUtc    = [DateTime]::UtcNow.ToString("o")
}

$result | Format-List
Write-Host "Synthetic checks passed." -ForegroundColor Green

