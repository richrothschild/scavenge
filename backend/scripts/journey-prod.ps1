param(
  [string]$BaseUrl = "https://api.boyzweekend.org/api",
  [string]$WebUrl = "https://www.boyzweekend.org",
  [string]$AdminSecret = $env:ADMIN_PASSWORD,
  [string]$CanaryTeamId = "spades"
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

function New-IdempotencyKey {
  param([string]$Scope)
  return "$Scope-$([Guid]::NewGuid().ToString())"
}

if ([string]::IsNullOrWhiteSpace($AdminSecret)) {
  throw "Admin password is required. Pass -AdminSecret or set ADMIN_PASSWORD environment variable."
}

Write-Host "Running production canary journey against $normalizedBaseUrl" -ForegroundColor Cyan

$webResponse = Invoke-StatusCheck -Uri $normalizedWebUrl -Name "Web root"
$adminResponse = Invoke-StatusCheck -Uri $adminUrl -Name "Admin route"

$health = Invoke-RestMethod -Method Get -Uri "$normalizedBaseUrl/health"
if (-not [bool]$health.ok) {
  throw "Health endpoint did not return ok=true."
}

$loginBody = @{ password = $AdminSecret } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$normalizedBaseUrl/auth/admin/login" -ContentType "application/json" -Body $loginBody
if ([string]::IsNullOrWhiteSpace($login.token)) {
  throw "Admin login succeeded but no token was returned."
}

$adminHeaders = @{ "x-admin-token" = $login.token }

$gameStatus = Invoke-RestMethod -Method Get -Uri "$normalizedBaseUrl/game/status"
$leaderboard = Invoke-RestMethod -Method Get -Uri "$normalizedBaseUrl/leaderboard"
$reviewQueue = Invoke-RestMethod -Method Get -Uri "$normalizedBaseUrl/admin/review-queue?limit=5&offset=0" -Headers $adminHeaders
$securityEvents = Invoke-RestMethod -Method Get -Uri "$normalizedBaseUrl/admin/security-events?limit=5&offset=0" -Headers $adminHeaders
$auditLogs = Invoke-RestMethod -Method Get -Uri "$normalizedBaseUrl/admin/audit-logs?limit=5&offset=0" -Headers $adminHeaders
$teamAssignments = Invoke-RestMethod -Method Get -Uri "$normalizedBaseUrl/admin/team-assignments" -Headers $adminHeaders
$joinOptions = Invoke-RestMethod -Method Get -Uri "$normalizedBaseUrl/join/options"

$team = @($joinOptions.teams | Where-Object { $_.teamId -eq $CanaryTeamId } | Select-Object -First 1)
if (-not $team) {
  $team = @($joinOptions.teams | Select-Object -First 1)
}
if (-not $team) {
  throw "No team found in join options."
}

$runId = [DateTime]::UtcNow.ToString("yyyyMMddHHmmss")
$participantName = "Canary Member $runId"
$cleanupPending = $false

try {
  $assignBody = @{ teamId = $team.teamId; participantName = $participantName } | ConvertTo-Json
  $assignHeaders = @{
    "x-admin-token" = $login.token
    "x-idempotency-key" = (New-IdempotencyKey -Scope "journey-assign")
  }

  Invoke-RestMethod -Method Post -Uri "$normalizedBaseUrl/admin/team-assignments/assign" -Headers $assignHeaders -ContentType "application/json" -Body $assignBody | Out-Null
  $cleanupPending = $true

  $joinBody = @{ joinCode = $team.teamName; displayName = $participantName } | ConvertTo-Json
  $joinResult = Invoke-RestMethod -Method Post -Uri "$normalizedBaseUrl/auth/join" -ContentType "application/json" -Body $joinBody

  $authToken = $joinResult.session.token
  if ([string]::IsNullOrWhiteSpace($authToken)) {
    throw "Join endpoint returned no auth token for canary participant."
  }

  $playerHeaders = @{ "x-auth-token" = $authToken }
  $teamState = Invoke-RestMethod -Method Get -Uri "$normalizedBaseUrl/team/me/state" -Headers $playerHeaders
  $eventFeed = Invoke-RestMethod -Method Get -Uri "$normalizedBaseUrl/team/me/event-feed?limit=5&offset=0" -Headers $playerHeaders
  $submissions = Invoke-RestMethod -Method Get -Uri "$normalizedBaseUrl/team/me/submissions?limit=5&offset=0" -Headers $playerHeaders

  $leaderboardCount = if ($null -ne $leaderboard.teams) { @($leaderboard.teams).Count } else { 0 }
  $reviewCount = if ($null -ne $reviewQueue.items) { @($reviewQueue.items).Count } else { 0 }
  $securityCount = if ($null -ne $securityEvents.items) { @($securityEvents.items).Count } else { 0 }
  $auditCount = if ($null -ne $auditLogs.items) { @($auditLogs.items).Count } else { 0 }
  $teamAssignmentCount = if ($null -ne $teamAssignments.teams) { @($teamAssignments.teams).Count } else { 0 }
  $eventFeedCount = if ($null -ne $eventFeed.items) { @($eventFeed.items).Count } else { 0 }
  $submissionCount = if ($null -ne $submissions.items) { @($submissions.items).Count } else { 0 }

  $result = [PSCustomObject]@{
    WebStatusCode = $webResponse.StatusCode
    AdminStatusCode = $adminResponse.StatusCode
    HealthOk = [bool]$health.ok
    AdminLoginOk = $true
    GameStatus = $gameStatus.status
    LeaderboardTeams = $leaderboardCount
    ReviewQueueItemsChecked = $reviewCount
    SecurityItemsChecked = $securityCount
    AuditItemsChecked = $auditCount
    TeamAssignmentsChecked = $teamAssignmentCount
    CanaryTeamId = $team.teamId
    CanaryMember = $participantName
    PlayerStateClueIndex = $teamState.currentClueIndex
    PlayerEventFeedItems = $eventFeedCount
    PlayerSubmissionItems = $submissionCount
    CheckedAtUtc = [DateTime]::UtcNow.ToString("o")
  }

  $result | Format-List
  Write-Host "Production canary journey passed." -ForegroundColor Green
}
finally {
  if ($cleanupPending) {
    try {
      $removeBody = @{ teamId = $team.teamId; participantName = $participantName } | ConvertTo-Json
      Invoke-RestMethod -Method Post -Uri "$normalizedBaseUrl/admin/team-assignments/remove" -Headers $adminHeaders -ContentType "application/json" -Body $removeBody | Out-Null
      Write-Host "Canary cleanup complete for $participantName on $($team.teamId)." -ForegroundColor DarkGray
    }
    catch {
      Write-Warning "Canary cleanup failed for $participantName on $($team.teamId): $($_.Exception.Message)"
    }
  }
}
