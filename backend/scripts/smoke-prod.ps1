param(
  [string]$BaseUrl = "https://scavenge-backend-production.up.railway.app/api",
  [string]$AdminPassword = $env:ADMIN_PASSWORD
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($AdminPassword)) {
  throw "Admin password is required. Pass -AdminPassword or set ADMIN_PASSWORD environment variable."
}

Write-Host "Running production smoke test against $BaseUrl" -ForegroundColor Cyan

$health = Invoke-RestMethod -Method Get -Uri "$BaseUrl/health"

$loginBody = @{ password = $AdminPassword } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$BaseUrl/auth/admin/login" -ContentType "application/json" -Body $loginBody
if ([string]::IsNullOrWhiteSpace($login.token)) {
  throw "Admin login succeeded but no token was returned."
}

$status = Invoke-RestMethod -Method Get -Uri "$BaseUrl/game/status"
$leaderboard = Invoke-RestMethod -Method Get -Uri "$BaseUrl/leaderboard" -Headers @{ "x-admin-token" = $login.token }

$teamCount = 0
if ($null -ne $leaderboard.teams) {
  $teamCount = @($leaderboard.teams).Count
}

$result = [PSCustomObject]@{
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
