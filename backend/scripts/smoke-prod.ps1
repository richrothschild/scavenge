param(
  [string]$BaseUrl = "https://api.boyzweekend.org/api",
  [string]$WebUrl = "https://www.boyzweekend.org",
  [string]$ExpectedCorsOrigin = "https://www.boyzweekend.org",
  [string]$AdminPassword = $env:ADMIN_PASSWORD
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$normalizedBaseUrl = $BaseUrl.TrimEnd("/")
if (-not $normalizedBaseUrl.EndsWith("/api")) {
  $normalizedBaseUrl = "$normalizedBaseUrl/api"
}

$normalizedWebUrl = $WebUrl.TrimEnd("/")
$adminUrl = "$normalizedWebUrl/admin"

function Invoke-StatusCheck {
  param(
    [string]$Uri,
    [string]$Name,
    [int]$ExpectedStatusCode = 200
  )

  try {
    $response = Invoke-WebRequest -Method Get -Uri $Uri
  }
  catch {
    throw "$Name check failed at $Uri. $($_.Exception.Message)"
  }

  if ($response.StatusCode -ne $ExpectedStatusCode) {
    throw "$Name check failed at $Uri. Expected status $ExpectedStatusCode, got $($response.StatusCode)."
  }

  return $response
}

function Test-CorsPreflight {
  param(
    [string]$Origin,
    [string]$JoinEndpoint
  )

  $headers = @{
    "Origin" = $Origin
    "Access-Control-Request-Method" = "POST"
    "Access-Control-Request-Headers" = "content-type"
  }

  try {
    $response = Invoke-WebRequest -Method Options -Uri $JoinEndpoint -Headers $headers
  }
  catch {
    throw "CORS preflight failed at $JoinEndpoint for origin $Origin. $($_.Exception.Message)"
  }

  $allowOrigin = $response.Headers["Access-Control-Allow-Origin"]
  if ([string]::IsNullOrWhiteSpace($allowOrigin)) {
    throw "CORS preflight did not include Access-Control-Allow-Origin for origin $Origin."
  }

  if ($allowOrigin -ne "*" -and $allowOrigin -ne $Origin) {
    throw "CORS preflight returned Access-Control-Allow-Origin '$allowOrigin', expected '$Origin'."
  }

  return $allowOrigin
}

if ([string]::IsNullOrWhiteSpace($AdminPassword)) {
  throw "Admin password is required. Pass -AdminPassword or set ADMIN_PASSWORD environment variable."
}

Write-Host "Running production smoke test against $normalizedBaseUrl" -ForegroundColor Cyan

$webResponse = Invoke-StatusCheck -Uri $normalizedWebUrl -Name "Web root"
$adminResponse = Invoke-StatusCheck -Uri $adminUrl -Name "Admin route"

$joinEndpoint = "$normalizedBaseUrl/auth/join"
$allowOrigin = Test-CorsPreflight -Origin $ExpectedCorsOrigin -JoinEndpoint $joinEndpoint

$health = Invoke-RestMethod -Method Get -Uri "$normalizedBaseUrl/health"

$loginBody = @{ password = $AdminPassword } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$normalizedBaseUrl/auth/admin/login" -ContentType "application/json" -Body $loginBody
if ([string]::IsNullOrWhiteSpace($login.token)) {
  throw "Admin login succeeded but no token was returned."
}

$status = Invoke-RestMethod -Method Get -Uri "$normalizedBaseUrl/game/status"
$leaderboard = Invoke-RestMethod -Method Get -Uri "$normalizedBaseUrl/leaderboard" -Headers @{ "x-admin-token" = $login.token }

$teamCount = 0
if ($null -ne $leaderboard.teams) {
  $teamCount = @($leaderboard.teams).Count
}

$result = [PSCustomObject]@{
  WebStatusCode      = $webResponse.StatusCode
  AdminStatusCode    = $adminResponse.StatusCode
  CorsAllowOrigin    = $allowOrigin
  HealthOk           = [bool]$health.ok
  GameStatus         = $status.status
  GameName           = $status.name
  LeaderboardTeams   = $teamCount
  CheckedAtUtc       = [DateTime]::UtcNow.ToString("o")
}

$result | Format-List

if (-not $result.HealthOk) {
  throw "Health endpoint did not return ok=true."
}

if ($teamCount -lt 1) {
  throw "Leaderboard returned no teams."
}

Write-Host "Production smoke test passed." -ForegroundColor Green
