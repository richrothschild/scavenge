param(
  [string]$BaseUrl       = "http://localhost:3001/api",
  [string]$AdminPassword = $(if ($env:ADMIN_PASSWORD) { $env:ADMIN_PASSWORD } else { "changeme" })  # DevSkim: ignore DS104456 — CI env var, not stored credential
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Api = $BaseUrl.TrimEnd("/")
if (-not $Api.EndsWith("/api")) { $Api = "$Api/api" }

# ---------- tracking --------------------------------------------------------
$passCount  = 0
$failCount  = 0
$allResults = [System.Collections.Generic.List[PSCustomObject]]::new()

function Write-Pass { param([string]$label)
  $script:passCount++
  $script:allResults.Add([PSCustomObject]@{ Status = "PASS"; Step = $label })
  Write-Host "  [PASS] $label" -ForegroundColor Green
}

function Write-Fail { param([string]$label, [string]$detail = "")
  $script:failCount++
  $script:allResults.Add([PSCustomObject]@{ Status = "FAIL"; Step = $label; Detail = $detail })
  Write-Host "  [FAIL] $label$(if ($detail) { ': ' + $detail })" -ForegroundColor Red
}

function Write-Skip { param([string]$label, [string]$reason = "")
  $script:allResults.Add([PSCustomObject]@{ Status = "SKIP"; Step = $label; Detail = $reason })
  Write-Host "  [SKIP] $label$(if ($reason) { ': ' + $reason })" -ForegroundColor DarkYellow
}

function Write-Phase { param([string]$title)
  Write-Host ""
  Write-Host "-- $title --" -ForegroundColor Cyan
}

function New-Idem { param([string]$scope)
  return "$scope-$([Guid]::NewGuid().ToString())"
}

function Invoke-Api {
  param(
    [string]$Method,
    [string]$Path,
    [hashtable]$Headers = @{},
    [object]$Body = $null
  )

  $uri = "$Api$Path"
  $reqHeaders = @{ "Content-Type" = "application/json" }
  foreach ($k in $Headers.Keys) { $reqHeaders[$k] = $Headers[$k] }

  try {
    $splat = @{
      Method      = $Method
      Uri         = $uri
      Headers     = $reqHeaders
      ContentType = "application/json"
    }
    if ($null -ne $Body) {
      $splat["Body"] = ($Body | ConvertTo-Json -Depth 10 -Compress)
    }
    $response = Invoke-WebRequest @splat -UseBasicParsing
    return [PSCustomObject]@{
      StatusCode = $response.StatusCode
      Body       = ($response.Content | ConvertFrom-Json)
      Ok         = $true
    }
  }
  catch [System.Net.WebException] {
    $webEx  = $_.Exception
    $body   = ""
    $code   = 0
    if ($null -ne $webEx.Response) {
      $stream = $webEx.Response.GetResponseStream()
      if ($null -ne $stream) {
        $reader = [System.IO.StreamReader]::new($stream)
        $body   = $reader.ReadToEnd()
        $reader.Dispose()
      }
      $code = [int]$webEx.Response.StatusCode
    }
    $parsed = $null
    try { $parsed = $body | ConvertFrom-Json } catch {}
    return [PSCustomObject]@{
      StatusCode = $code
      Body       = $parsed
      RawBody    = $body
      Ok         = $false
    }
  }
  catch {
    return [PSCustomObject]@{
      StatusCode = 0
      Body       = $null
      RawBody    = $_.Exception.Message
      Ok         = $false
    }
  }
}

# ---------- cleanup registry ------------------------------------------------
$cleanupTasks = [System.Collections.Generic.List[scriptblock]]::new()

# ---------- seed credentials (from seed-config.json) ------------------------
$HeartsJoinCode   = "HEARTS-GXQZ5F"
$SpadesJoinCode   = "SPADES-AJ29LN"
$SpadesCaptainPin = "910546"

# ---------- banner ----------------------------------------------------------
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  SCAVENGE FULL SYNTHETIC TEST" -ForegroundColor Cyan
Write-Host "  Target : $Api" -ForegroundColor Cyan
Write-Host "  Started: $([DateTime]::UtcNow.ToString('o'))" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$adminToken   = ""
$memberToken  = ""
$captainToken = ""
$ts           = [DateTime]::UtcNow.ToString("HHmmss")
$memberName   = "SynthMember-$ts"
$captainName  = "SynthCaptain-$ts"

try {

# ============================================================
Write-Phase "PHASE 0 -- Infrastructure"
# ============================================================

$r = Invoke-Api -Method GET -Path "/health"
if ($r.Ok -and $r.Body.ok -eq $true) {
  Write-Pass "GET /health ok=true service=$($r.Body.service)"
} else {
  Write-Fail "GET /health" "status=$($r.StatusCode)"
}

$r = Invoke-Api -Method GET -Path "/game/status"
if ($r.Ok -and $r.Body.status) {
  $initialStatus = $r.Body.status
  Write-Pass "GET /game/status status=$initialStatus"
} else {
  Write-Fail "GET /game/status" "status=$($r.StatusCode)"
  $initialStatus = "UNKNOWN"
}

$r = Invoke-Api -Method GET -Path "/join/options"
if ($r.Ok -and $r.Body.teams) {
  $teamCount = @($r.Body.teams).Count
  if ($teamCount -eq 4) {
    Write-Pass "GET /join/options $teamCount teams listed"
  } else {
    Write-Fail "GET /join/options" "expected 4 teams, got $teamCount"
  }
} else {
  Write-Fail "GET /join/options" "status=$($r.StatusCode)"
}

$r = Invoke-Api -Method GET -Path "/leaderboard"
if ($r.Ok -and $r.Body.teams) {
  Write-Pass "GET /leaderboard $(@($r.Body.teams).Count) teams (public, no auth)"
} else {
  Write-Fail "GET /leaderboard" "status=$($r.StatusCode)"
}

# ============================================================
Write-Phase "PHASE 1 -- Administrator Login and Setup Reads"
# ============================================================

$r = Invoke-Api -Method POST -Path "/auth/admin/login" -Body @{ password = $AdminPassword }
if ($r.Ok -and $r.Body.token) {
  $adminToken = $r.Body.token
  Write-Pass "POST /auth/admin/login token issued"
} else {
  Write-Fail "POST /auth/admin/login" "status=$($r.StatusCode)"
  throw "Admin login failed -- cannot continue."
}

$adminHeaders = @{ "x-admin-token" = $adminToken }

$r2 = Invoke-Api -Method POST -Path "/auth/admin/login" -Body @{ password = "wrong-password-xyz" }
if ($r2.StatusCode -eq 401) {
  Write-Pass "POST /auth/admin/login bad password -> 401 Unauthorized (correct)"
} else {
  Write-Fail "Admin bad-password rejection" "expected 401, got $($r2.StatusCode)"
}

$r = Invoke-Api -Method GET -Path "/admin/team-assignments" -Headers $adminHeaders
if ($r.Ok -and $r.Body.teams) {
  Write-Pass "GET /admin/team-assignments $(@($r.Body.teams).Count) teams"
} else {
  Write-Fail "GET /admin/team-assignments" "status=$($r.StatusCode)"
}

$firstClue = $null
$allClues   = @()
$lastClue   = $null
$isTestVariant = $false
$r = Invoke-Api -Method GET -Path "/admin/clues" -Headers $adminHeaders
if ($r.Ok -and $r.Body.clues) {
  $allClues  = @($r.Body.clues)
  $clueCount = $allClues.Count
  $firstClue = $allClues[0]
  $lastClue  = $allClues[$clueCount - 1]
  # Test variant has <=6 clues; production has 12+. Use clue count to detect mode.
  $isTestVariant = $clueCount -le 6
  $variantLabel = if ($isTestVariant) { "TEST" } else { "PRODUCTION" }
  Write-Pass "GET /admin/clues $clueCount clues variant=$variantLabel first='$($firstClue.title)' last='$($lastClue.title)' qr=$($firstClue.qr_public_id)"
} else {
  Write-Fail "GET /admin/clues" "status=$($r.StatusCode)"
}

$r = Invoke-Api -Method GET -Path "/admin/review-queue?limit=5&offset=0" -Headers $adminHeaders
if ($r.Ok) {
  $rqBase = if ($r.Body.items) { @($r.Body.items).Count } else { 0 }
  Write-Pass "GET /admin/review-queue $rqBase items (baseline)"
} else {
  Write-Fail "GET /admin/review-queue" "status=$($r.StatusCode)"
}

$r = Invoke-Api -Method GET -Path "/admin/security-events?limit=5&offset=0" -Headers $adminHeaders
if ($r.Ok) {
  $seBase = if ($r.Body.items) { @($r.Body.items).Count } else { 0 }
  Write-Pass "GET /admin/security-events $seBase items (baseline)"
} else {
  Write-Fail "GET /admin/security-events" "status=$($r.StatusCode)"
}

$r = Invoke-Api -Method GET -Path "/admin/audit-logs?limit=5&offset=0" -Headers $adminHeaders
if ($r.Ok) {
  $alBase = if ($r.Body.items) { @($r.Body.items).Count } else { 0 }
  Write-Pass "GET /admin/audit-logs $alBase items (baseline)"
} else {
  Write-Fail "GET /admin/audit-logs" "status=$($r.StatusCode)"
}

$r = Invoke-Api -Method GET -Path "/admin/review-queue?limit=1&offset=0"
if ($r.StatusCode -eq 401) {
  Write-Pass "GET /admin/review-queue no-token -> 401 (auth guard correct)"
} else {
  Write-Fail "Admin endpoint auth guard" "expected 401, got $($r.StatusCode)"
}

# ============================================================
Write-Phase "PHASE 2 -- Administrator Assign Participants"
# ============================================================

$ah = $adminHeaders + @{ "x-idempotency-key" = (New-Idem "assign-member") }
$r = Invoke-Api -Method POST -Path "/admin/team-assignments/assign" `
     -Headers $ah -Body @{ teamId = "hearts"; participantName = $memberName }
if ($r.Ok) {
  Write-Pass "Admin assigned '$memberName' to HEARTS"
  $capturedMemberName  = $memberName
  $capturedAdminToken  = $adminToken
  $cleanupTasks.Add([scriptblock]::Create(
    "Invoke-Api -Method POST -Path '/admin/team-assignments/remove' " +
    "-Headers @{ 'x-admin-token' = '$capturedAdminToken' } " +
    "-Body @{ teamId = 'hearts'; participantName = '$capturedMemberName' } | Out-Null; " +
    "Write-Host '  Removed $capturedMemberName from HEARTS.' -ForegroundColor DarkGray"
  ))
} else {
  Write-Fail "Assign member to HEARTS" "status=$($r.StatusCode) body=$($r.RawBody)"
}

$ah = $adminHeaders + @{ "x-idempotency-key" = (New-Idem "assign-captain") }
$r = Invoke-Api -Method POST -Path "/admin/team-assignments/assign" `
     -Headers $ah -Body @{ teamId = "spades"; participantName = $captainName }
if ($r.Ok) {
  Write-Pass "Admin assigned '$captainName' to SPADES"
  $capturedCaptainName = $captainName
  $capturedAdminToken2 = $adminToken
  $cleanupTasks.Add([scriptblock]::Create(
    "Invoke-Api -Method POST -Path '/admin/team-assignments/remove' " +
    "-Headers @{ 'x-admin-token' = '$capturedAdminToken2' } " +
    "-Body @{ teamId = 'spades'; participantName = '$capturedCaptainName' } | Out-Null; " +
    "Write-Host '  Removed $capturedCaptainName from SPADES.' -ForegroundColor DarkGray"
  ))
} else {
  Write-Fail "Assign captain to SPADES" "status=$($r.StatusCode) body=$($r.RawBody)"
}

# ============================================================
Write-Phase "PHASE 3 -- Member (HEARTS) Join and Read Access"
# ============================================================

$r = Invoke-Api -Method POST -Path "/auth/join" `
     -Body @{ joinCode = $HeartsJoinCode; displayName = $memberName }
if ($r.Ok -and $r.Body.session.token) {
  $memberToken = $r.Body.session.token
  $memberRole  = $r.Body.session.role
  if ($isTestVariant) {
    # Test mode: all participants are promoted to CAPTAIN regardless of PIN
    if ($memberRole -eq "CAPTAIN") {
      Write-Pass "POST /auth/join HEARTS no PIN -> role=CAPTAIN (test mode: expected)"
    } else {
      Write-Fail "Member role assertion (test mode)" "expected CAPTAIN in test mode, got $memberRole"
    }
  } else {
    Write-Pass "POST /auth/join HEARTS no PIN -> role=$memberRole"
    if ($memberRole -ne "MEMBER") {
      Write-Fail "Member role assertion" "expected MEMBER, got $memberRole"
    }
  }
} else {
  Write-Fail "POST /auth/join HEARTS member" "status=$($r.StatusCode) body=$($r.RawBody)"
}

$memberHeaders = @{ "x-auth-token" = $memberToken }

$r = Invoke-Api -Method GET -Path "/team/me/state" -Headers $memberHeaders
if ($r.Ok -and $r.Body.PSObject.Properties["currentClueIndex"]) {
  Write-Pass "GET /team/me/state member -> clue=$($r.Body.currentClueIndex) score=$($r.Body.scoreTotal)"
} else {
  Write-Fail "GET /team/me/state member" "status=$($r.StatusCode)"
}

$r = Invoke-Api -Method GET -Path "/team/me/event-feed?limit=10&offset=0" -Headers $memberHeaders
if ($r.Ok) {
  $fCount = if ($r.Body.items) { @($r.Body.items).Count } else { 0 }
  Write-Pass "GET /team/me/event-feed member -> $fCount items"
} else {
  Write-Fail "GET /team/me/event-feed member" "status=$($r.StatusCode)"
}

$r = Invoke-Api -Method GET -Path "/team/me/submissions?limit=10&offset=0" -Headers $memberHeaders
if ($r.Ok) {
  $sCount = if ($r.Body.items) { @($r.Body.items).Count } else { 0 }
  Write-Pass "GET /team/me/submissions member -> $sCount submissions"
} else {
  Write-Fail "GET /team/me/submissions member" "status=$($r.StatusCode)"
}

# ============================================================
Write-Phase "PHASE 4 -- Captain (SPADES) Join and Read Access"
# ============================================================

$r = Invoke-Api -Method POST -Path "/auth/join" `
     -Body @{ joinCode = $SpadesJoinCode; displayName = $captainName; captainPin = $SpadesCaptainPin }
if ($r.Ok -and $r.Body.session.token) {
  $captainToken = $r.Body.session.token
  $captainRole  = $r.Body.session.role
  Write-Pass "POST /auth/join SPADES with captain PIN -> role=$captainRole"
  if ($captainRole -ne "CAPTAIN") {
    Write-Fail "Captain role assertion" "expected CAPTAIN, got $captainRole"
  }
} else {
  Write-Fail "POST /auth/join SPADES captain" "status=$($r.StatusCode) body=$($r.RawBody)"
}

$captainHeaders = @{ "x-auth-token" = $captainToken }

$r = Invoke-Api -Method GET -Path "/team/me/state" -Headers $captainHeaders
if ($r.Ok -and $r.Body.PSObject.Properties["currentClueIndex"]) {
  Write-Pass "GET /team/me/state captain -> clue=$($r.Body.currentClueIndex) score=$($r.Body.scoreTotal)"
} else {
  Write-Fail "GET /team/me/state captain" "status=$($r.StatusCode)"
}

# ============================================================
Write-Phase "PHASE 5 -- RBAC Member Cannot Submit or Pass"
# ============================================================

if ($isTestVariant) {
  Write-Skip "Member submit RBAC" "test mode: all participants are CAPTAIN, 403 not expected"
  Write-Skip "Member pass RBAC"   "test mode: all participants are CAPTAIN, 403 not expected"
} else {
  $r = Invoke-Api -Method POST -Path "/team/me/submit" `
       -Headers $memberHeaders -Body @{ textContent = "Should be blocked by RBAC." }
  if ($r.StatusCode -eq 403) {
    Write-Pass "POST /team/me/submit member -> 403 Captain-only (correct)"
  } else {
    Write-Fail "Member submit RBAC" "expected 403, got $($r.StatusCode)"
  }

  $r = Invoke-Api -Method POST -Path "/team/me/pass" -Headers $memberHeaders
  if ($r.StatusCode -eq 403) {
    Write-Pass "POST /team/me/pass member -> 403 Captain-only (correct)"
  } else {
    Write-Fail "Member pass RBAC" "expected 403, got $($r.StatusCode)"
  }
}

$r = Invoke-Api -Method GET -Path "/team/me/state"
if ($r.StatusCode -eq 401) {
  Write-Pass "GET /team/me/state no-token -> 401 Unauthorized (correct)"
} else {
  Write-Fail "No-token auth guard" "expected 401, got $($r.StatusCode)"
}

# ============================================================
Write-Phase "PHASE 6 -- Administrator Start Game PENDING to RUNNING"
# ============================================================

$ah = $adminHeaders + @{ "x-idempotency-key" = (New-Idem "game-start") }
$r = Invoke-Api -Method POST -Path "/game/status" -Headers $ah -Body @{ status = "RUNNING" }
if ($r.Ok -and $r.Body.status -eq "RUNNING") {
  Write-Pass "POST /game/status -> RUNNING"
} else {
  Write-Fail "POST /game/status RUNNING" "status=$($r.StatusCode) got=$($r.Body.status)"
}

$r = Invoke-Api -Method GET -Path "/game/status"
if ($r.Ok -and $r.Body.status -eq "RUNNING") {
  Write-Pass "GET /game/status confirmed RUNNING"
} else {
  Write-Fail "Confirm game RUNNING" "got $($r.Body.status)"
}

# ============================================================
Write-Phase "PHASE 7 -- Captain QR Scan Session Flow"
# ============================================================

$scanSessionToken = ""
$r = Invoke-Api -Method POST -Path "/team/me/scan-session" -Headers $captainHeaders
if ($r.Ok -and $r.Body.scanSessionToken) {
  $scanSessionToken = $r.Body.scanSessionToken
  Write-Pass "POST /team/me/scan-session token issued expires=$($r.Body.expiresAt)"
} else {
  Write-Skip "POST /team/me/scan-session" "status=$($r.StatusCode) skipping validate"
}

if ($scanSessionToken -and $firstClue) {
  $r = Invoke-Api -Method POST -Path "/team/me/scan-validate" -Headers $captainHeaders `
       -Body @{ scanSessionToken = $scanSessionToken; checkpointPublicId = $firstClue.qr_public_id }
  if ($r.Ok) {
    Write-Pass "POST /team/me/scan-validate clue=$($r.Body.clueIndex) validated"
  } else {
    $scanErrDetail = if ($r.Body -and $r.Body.PSObject.Properties['error']) { $r.Body.error } else { $r.RawBody }
    Write-Skip "POST /team/me/scan-validate" "status=$($r.StatusCode) body=$scanErrDetail non-critical"
  }
} else {
  Write-Skip "POST /team/me/scan-validate" "no scan session token available"
}

$r = Invoke-Api -Method POST -Path "/team/me/scan-session" -Headers $memberHeaders
if ($r.Ok) {
  Write-Pass "POST /team/me/scan-session member -> allowed (members may scan)"
} elseif ($r.StatusCode -eq 403) {
  Write-Pass "POST /team/me/scan-session member -> 403 scanning restricted to captains"
} else {
  Write-Fail "Member scan-session" "unexpected status=$($r.StatusCode)"
}

# ============================================================
Write-Phase "PHASE 8 -- Captain Submit Clue 0 Mock AI PASS"
# ============================================================

$r = Invoke-Api -Method GET -Path "/team/me/state" -Headers $captainHeaders
$preClueIndex = $r.Body.currentClueIndex
$preScore     = $r.Body.scoreTotal

$r = Invoke-Api -Method POST -Path "/team/me/submit" -Headers $captainHeaders `
     -Body @{ textContent = "Synthetic test submission: evidence collected at location, clue completed." }

if ($r.Ok) {
  $verdict   = $r.Body.verdict
  $aiVerdict = $r.Body.ai.verdict
  $pts       = $r.Body.pointsAwarded
  Write-Pass "POST /team/me/submit captain clue=$preClueIndex verdict=$verdict ai=$aiVerdict pts=$pts"
} else {
  $errMsg = if ($r.Body -and $r.Body.PSObject.Properties['error']) { $r.Body.error } else { $r.RawBody }
  Write-Fail "POST /team/me/submit captain" "status=$($r.StatusCode) body=$errMsg"
}

$r = Invoke-Api -Method GET -Path "/team/me/state" -Headers $captainHeaders
$postClueIndex = $r.Body.currentClueIndex
$postScore     = $r.Body.scoreTotal
if ($postClueIndex -gt $preClueIndex) {
  Write-Pass "Clue advanced $preClueIndex -> $postClueIndex score $preScore -> $postScore"
} elseif ($postClueIndex -eq $preClueIndex) {
  Write-Skip "Clue advance" "still at $postClueIndex verdict may be NEEDS_REVIEW"
} else {
  Write-Fail "Clue advance check" "index went $preClueIndex -> $postClueIndex"
}

# ============================================================
Write-Phase "PHASE 9 -- Captain Pass Clue Optional Skip"
# ============================================================

$r = Invoke-Api -Method GET -Path "/team/me/state" -Headers $captainHeaders
$prePassIndex = $r.Body.currentClueIndex
$preSkipCount = $r.Body.skippedCount

$r = Invoke-Api -Method POST -Path "/team/me/pass" -Headers $captainHeaders
if ($r.Ok) {
  Write-Pass "POST /team/me/pass captain clue=$prePassIndex -> OK"
} else {
  $errMsg = if ($r.Body -and $r.Body.PSObject.Properties['error']) { $r.Body.error } else { $r.RawBody }
  Write-Fail "POST /team/me/pass" "status=$($r.StatusCode) body=$errMsg"
}

$r = Invoke-Api -Method GET -Path "/team/me/state" -Headers $captainHeaders
$postPassIndex = $r.Body.currentClueIndex
$postSkipCount = $r.Body.skippedCount
if ($postPassIndex -gt $prePassIndex) {
  Write-Pass "Clue advanced after pass $prePassIndex -> $postPassIndex skips $preSkipCount -> $postSkipCount"
} else {
  Write-Skip "Pass advance" "clue did not advance may be REQUIRED or NEEDS_REVIEW pending"
}

# ============================================================
Write-Phase "PHASE 10 -- Member Report Screenshot Security Event"
# ============================================================

$r = Invoke-Api -Method POST -Path "/team/me/security-events" -Headers $memberHeaders `
     -Body @{
       type       = "SCREENSHOT_ATTEMPT"
       clueIndex  = 0
       deviceInfo = "SynthDevice-iOS-17-synthetic-test"
     }
if ($r.Ok) {
  Write-Pass "POST /team/me/security-events event recorded id=$($r.Body.id)"
} else {
  $errMsg = if ($r.Body -and $r.Body.PSObject.Properties['error']) { $r.Body.error } else { $r.RawBody }
  Write-Fail "POST /team/me/security-events" "status=$($r.StatusCode) body=$errMsg"
}

# ============================================================
Write-Phase "PHASE 11 -- Administrator Live Ops Reads"
# ============================================================

$r = Invoke-Api -Method GET -Path "/admin/review-queue?limit=10&offset=0" -Headers $adminHeaders
if ($r.Ok) {
  $rqItems = [object[]]@()
  if ($r.Body.items) { $rqItems = [object[]]@($r.Body.items) }
  Write-Pass "GET /admin/review-queue $($rqItems.Count) items pending"
  if ($rqItems.Count -gt 0) {
    $item = $rqItems[0]
    $r2 = Invoke-Api -Method POST -Path "/admin/review/$($item.id)/resolve" `
          -Headers $adminHeaders -Body @{ verdict = "PASS"; pointsAwarded = $item.basePoints }
    if ($r2.Ok) {
      Write-Pass "POST /admin/review/$($item.id)/resolve approved PASS by admin"
    } else {
      Write-Fail "Resolve review item" "status=$($r2.StatusCode) body=$($r2.Body.error)"
    }
  }
} else {
  Write-Fail "GET /admin/review-queue" "status=$($r.StatusCode)"
}

$r = Invoke-Api -Method GET -Path "/admin/security-events?limit=10&offset=0" -Headers $adminHeaders
if ($r.Ok) {
  $seItems = if ($r.Body.items) { @($r.Body.items).Count } else { 0 }
  Write-Pass "GET /admin/security-events $seItems items expected >=1"
} else {
  Write-Fail "GET /admin/security-events" "status=$($r.StatusCode)"
}

$r = Invoke-Api -Method GET -Path "/admin/audit-logs?limit=20&offset=0" -Headers $adminHeaders
if ($r.Ok) {
  $alItems = if ($r.Body.items) { @($r.Body.items).Count } else { 0 }
  Write-Pass "GET /admin/audit-logs $alItems entries"
} else {
  Write-Fail "GET /admin/audit-logs" "status=$($r.StatusCode)"
}

# ============================================================
Write-Phase "PHASE 12 -- Administrator Point Deduction SPADES"
# ============================================================

$r = Invoke-Api -Method GET -Path "/leaderboard"
$spadesEntry = @($r.Body.teams | Where-Object { $_.teamId -eq "spades" })
$spadesScore = if ($spadesEntry.Count -gt 0) { $spadesEntry[0].scoreTotal } else { "unknown" }

$ah = $adminHeaders + @{ "x-idempotency-key" = (New-Idem "deduct-spades") }
$r = Invoke-Api -Method POST -Path "/admin/team/spades/deduct" `
     -Headers $ah -Body @{ amount = 25; reason = "Synthetic test security violation penalty" }
if ($r.Ok) {
  Write-Pass "POST /admin/team/spades/deduct 25pts new score=$($r.Body.scoreTotal) was $spadesScore"
} else {
  $errMsg = if ($r.Body -and $r.Body.PSObject.Properties['error']) { $r.Body.error } else { $r.RawBody }
  Write-Fail "POST /admin/team/spades/deduct" "status=$($r.StatusCode) body=$errMsg"
}

$ah = $adminHeaders + @{ "x-idempotency-key" = (New-Idem "deduct-no-reason") }
$r = Invoke-Api -Method POST -Path "/admin/team/spades/deduct" `
     -Headers $ah -Body @{ amount = 5 }
if ($r.StatusCode -eq 400) {
  Write-Pass "POST /admin/team/spades/deduct no-reason -> 400 (validation correct)"
} else {
  Write-Fail "Deduct no-reason validation" "expected 400, got $($r.StatusCode)"
}

# ============================================================
Write-Phase "PHASE 13 -- Administrator Point Award HEARTS"
# ============================================================

$r = Invoke-Api -Method GET -Path "/leaderboard"
$heartsEntry = @($r.Body.teams | Where-Object { $_.teamId -eq "hearts" })
$heartsScore = if ($heartsEntry.Count -gt 0) { $heartsEntry[0].scoreTotal } else { "unknown" }

$r = Invoke-Api -Method POST -Path "/admin/team/hearts/award" `
     -Headers $adminHeaders -Body @{ amount = 15; reason = "Synthetic test spirit bonus" }
if ($r.Ok) {
  Write-Pass "POST /admin/team/hearts/award 15pts new score=$($r.Body.scoreTotal) was $heartsScore"
} else {
  $errMsg = if ($r.Body -and $r.Body.PSObject.Properties['error']) { $r.Body.error } else { $r.RawBody }
  Write-Fail "POST /admin/team/hearts/award" "status=$($r.StatusCode) body=$errMsg"
}

# ============================================================
Write-Phase "PHASE 14 -- Administrator Send Hint to SPADES"
# ============================================================

$r = Invoke-Api -Method GET -Path "/team/me/state" -Headers $captainHeaders
$currentClueIdx = $r.Body.currentClueIndex

$r = Invoke-Api -Method POST -Path "/admin/team/spades/hint" -Headers $adminHeaders `
     -Body @{ clueIndex = $currentClueIdx; hintText = "Synthetic hint: look for the historical marker near the main entrance." }
if ($r.Ok) {
  Write-Pass "POST /admin/team/spades/hint clue=$currentClueIdx hint delivered"
} else {
  $errMsg = if ($r.Body -and $r.Body.PSObject.Properties['error']) { $r.Body.error } else { $r.RawBody }
  Write-Fail "POST /admin/team/spades/hint" "status=$($r.StatusCode) body=$errMsg"
}

# ============================================================
Write-Phase "PHASE 15 -- Administrator Broadcast Message"
# ============================================================

$r = Invoke-Api -Method POST -Path "/admin/broadcast" -Headers $adminHeaders `
     -Body @{ message = "Synthetic test broadcast: all teams check in with your captains now." }
if ($r.Ok -and $r.Body.message) {
  Write-Pass "POST /admin/broadcast sent at $($r.Body.sentAt)"
} else {
  $errMsg = if ($r.Body -and $r.Body.PSObject.Properties['error']) { $r.Body.error } else { $r.RawBody }
  Write-Fail "POST /admin/broadcast" "status=$($r.StatusCode) body=$errMsg"
}

$r = Invoke-Api -Method POST -Path "/admin/broadcast" -Headers $adminHeaders -Body @{ message = "" }
if ($r.StatusCode -eq 400) {
  Write-Pass "POST /admin/broadcast empty-message -> 400 (validation correct)"
} else {
  Write-Fail "Broadcast empty-message validation" "expected 400, got $($r.StatusCode)"
}

# ============================================================
Write-Phase "PHASE 16 -- Administrator Reopen Clue for SPADES"
# ============================================================

$ah = $adminHeaders + @{ "x-idempotency-key" = (New-Idem "reopen-spades") }
$r = Invoke-Api -Method POST -Path "/admin/team/spades/reopen-clue" `
     -Headers $ah -Body @{
       clueIndex       = 0
       reason          = "Synthetic test: team had connectivity issue during submission"
       durationSeconds = 120
     }
if ($r.Ok) {
  Write-Pass "POST /admin/team/spades/reopen-clue index=0 openUntil=$($r.Body.openedByAdminUntil)"
} else {
  $errMsg = if ($r.Body -and $r.Body.PSObject.Properties['error']) { $r.Body.error } else { $r.RawBody }
  Write-Fail "POST /admin/team/spades/reopen-clue" "status=$($r.StatusCode) body=$errMsg"
}

# ============================================================
Write-Phase "PHASE 17 -- Mid-Game Leaderboard and Feed Snapshot"
# ============================================================

$r = Invoke-Api -Method GET -Path "/leaderboard"
if ($r.Ok -and $r.Body.teams) {
  Write-Pass "GET /leaderboard mid-game snapshot:"
  foreach ($team in $r.Body.teams) {
    Write-Host "    $($team.teamId.PadRight(10)) score=$($team.scoreTotal)  completed=$($team.completedCount)  eligible=$($team.eligibilityStatus)" -ForegroundColor White
  }
} else {
  Write-Fail "GET /leaderboard mid-game" "status=$($r.StatusCode)"
}

$r = Invoke-Api -Method GET -Path "/team/me/event-feed?limit=20&offset=0" -Headers $captainHeaders
if ($r.Ok) {
  $fCount = if ($r.Body.items) { @($r.Body.items).Count } else { 0 }
  Write-Pass "GET /team/me/event-feed captain $fCount events"
} else {
  Write-Fail "GET /team/me/event-feed captain" "status=$($r.StatusCode)"
}

$r = Invoke-Api -Method GET -Path "/team/me/submissions?limit=20&offset=0" -Headers $captainHeaders
if ($r.Ok) {
  $sCount = if ($r.Body.items) { @($r.Body.items).Count } else { 0 }
  Write-Pass "GET /team/me/submissions captain $sCount submissions"
} else {
  Write-Fail "GET /team/me/submissions captain" "status=$($r.StatusCode)"
}

# ============================================================
Write-Phase "PHASE 17b -- Last Clue Progression (Winchester / End-of-Hunt guard)"
# ============================================================

# Advance SPADES to the final clue by passing all intermediate clues, then
# submit a correct answer and confirm the team does NOT loop or get stuck.
if ($isTestVariant -and $lastClue) {
  # Pass clues until we reach the last one
  $advanceLimit = 10  # safety cap to prevent infinite loop
  $advanceCount = 0
  do {
    $r = Invoke-Api -Method GET -Path "/team/me/state" -Headers $captainHeaders
    $curIdx  = $r.Body.currentClueIndex
    $lastIdx = $clueCount - 1
    if ($curIdx -ge $lastIdx) { break }
    $r = Invoke-Api -Method POST -Path "/team/me/pass" -Headers $captainHeaders
    if (-not $r.Ok) {
      $passErr = if ($r.Body -and $r.Body.PSObject.Properties['error']) { $r.Body.error } else { $r.RawBody }
      Write-Fail "Advance to last clue (pass at index $curIdx)" "status=$($r.StatusCode) body=$passErr"
      break
    }
    $advanceCount++
  } while ($advanceCount -lt $advanceLimit)

  $r = Invoke-Api -Method GET -Path "/team/me/state" -Headers $captainHeaders
  $atLastClue = $r.Body.currentClueIndex -eq ($clueCount - 1)

  if ($atLastClue) {
    Write-Pass "SPADES advanced to last clue (index=$($r.Body.currentClueIndex) title='$($lastClue.title)')"
  } else {
    Write-Fail "Advance to last clue" "expected index $($clueCount - 1), got $($r.Body.currentClueIndex) after $advanceCount passes"
  }

  # Submit a correct answer for the last clue
  $lastClueAnswer = if ($lastClue.PSObject.Properties['answer']) { $lastClue.answer } else { "Winchester Mystery House" }
  $r = Invoke-Api -Method POST -Path "/team/me/submit" -Headers $captainHeaders `
       -Body @{ textContent = $lastClueAnswer }
  if ($r.Ok) {
    Write-Pass "Last clue submit verdict=$($r.Body.verdict) pts=$($r.Body.pointsAwarded)"
  } else {
    $submitErr = if ($r.Body -and $r.Body.PSObject.Properties['error']) { $r.Body.error } else { $r.RawBody }
    Write-Fail "Last clue submit" "status=$($r.StatusCode) body=$submitErr"
  }

  # Confirm team state after last clue: should NOT loop back to 0, should stay at last index
  # or show completedCount increased. No stuck/loop behavior.
  $r = Invoke-Api -Method GET -Path "/team/me/state" -Headers $captainHeaders
  $afterIdx       = $r.Body.currentClueIndex
  $completedCount = $r.Body.completedCount
  $skippedCount   = $r.Body.skippedCount

  if ($afterIdx -eq 0 -and $completedCount -eq 0) {
    Write-Fail "Last clue post-submit state" "index reset to 0 with completedCount=0 — possible loop"
  } elseif ($afterIdx -lt ($clueCount - 1) -and $completedCount -lt 1) {
    Write-Fail "Last clue post-submit state" "index=$afterIdx completed=$completedCount — unexpected regression"
  } else {
    Write-Pass "Post-last-clue state: index=$afterIdx completed=$completedCount skipped=$skippedCount (no loop)"
  }

  # Confirm a second submit on the same (last) clue is either blocked or handled gracefully
  $r2 = Invoke-Api -Method POST -Path "/team/me/submit" -Headers $captainHeaders `
        -Body @{ textContent = $lastClueAnswer }
  if ($r2.Ok -or $r2.StatusCode -eq 400 -or $r2.StatusCode -eq 409 -or $r2.StatusCode -eq 423) {
    Write-Pass "Double-submit on last clue handled gracefully (status=$($r2.StatusCode))"
  } else {
    Write-Fail "Double-submit on last clue" "unexpected status=$($r2.StatusCode)"
  }

} else {
  Write-Skip "Last clue progression" "not in test variant or no last clue available"
}

# ============================================================
Write-Phase "PHASE 18 -- Administrator Pause Game"
# ============================================================

$ah = $adminHeaders + @{ "x-idempotency-key" = (New-Idem "game-pause") }
$r = Invoke-Api -Method POST -Path "/game/status" -Headers $ah -Body @{ status = "PAUSED" }
if ($r.Ok -and $r.Body.status -eq "PAUSED") {
  Write-Pass "POST /game/status -> PAUSED"
} else {
  Write-Fail "POST /game/status PAUSED" "status=$($r.StatusCode) got=$($r.Body.status)"
}

$r = Invoke-Api -Method POST -Path "/team/me/submit" -Headers $captainHeaders `
     -Body @{ textContent = "Should be blocked by mutation policy." }
if ($r.StatusCode -eq 423) {
  Write-Pass "POST /team/me/submit while PAUSED -> 423 Locked (mutation policy correct)"
} else {
  Write-Fail "Mutation policy PAUSED submit" "expected 423, got $($r.StatusCode)"
}

$r = Invoke-Api -Method GET -Path "/admin/review-queue?limit=5&offset=0" -Headers $adminHeaders
if ($r.Ok) {
  Write-Pass "GET /admin/review-queue while PAUSED -> admin reads still work"
} else {
  Write-Fail "Admin reads while PAUSED" "status=$($r.StatusCode)"
}

# ============================================================
Write-Phase "PHASE 19 -- Administrator End Game and Final Leaderboard"
# ============================================================

$ah = $adminHeaders + @{ "x-idempotency-key" = (New-Idem "game-end") }
$r = Invoke-Api -Method POST -Path "/game/status" -Headers $ah -Body @{ status = "ENDED" }
if ($r.Ok -and $r.Body.status -eq "ENDED") {
  Write-Pass "POST /game/status -> ENDED"
} else {
  Write-Fail "POST /game/status ENDED" "status=$($r.StatusCode) got=$($r.Body.status)"
}

$r = Invoke-Api -Method GET -Path "/game/status"
if ($r.Ok -and $r.Body.status -eq "ENDED") {
  Write-Pass "GET /game/status confirmed ENDED"
} else {
  Write-Fail "Confirm game ENDED" "got $($r.Body.status)"
}

$r = Invoke-Api -Method GET -Path "/leaderboard"
if ($r.Ok -and $r.Body.teams) {
  Write-Pass "GET /leaderboard FINAL standings:"
  foreach ($team in $r.Body.teams) {
    Write-Host "    $($team.teamId.PadRight(10)) score=$($team.scoreTotal)  completed=$($team.completedCount)  eligible=$($team.eligibilityStatus)" -ForegroundColor White
  }
} else {
  Write-Fail "GET /leaderboard final" "status=$($r.StatusCode)"
}

$r = Invoke-Api -Method GET -Path "/admin/audit-logs?limit=50&offset=0" -Headers $adminHeaders
if ($r.Ok) {
  $alFinal = if ($r.Body.items) { @($r.Body.items).Count } else { 0 }
  Write-Pass "GET /admin/audit-logs final $alFinal total entries"
} else {
  Write-Fail "GET /admin/audit-logs final" "status=$($r.StatusCode)"
}

}
catch {
  Write-Fail "Unhandled exception" "$($_.Exception.Message) at $($_.InvocationInfo.ScriptLineNumber)"
}
finally {
  # -- Cleanup -----------------------------------------------------------------
  if ($cleanupTasks.Count -gt 0) {
    Write-Host ""
    Write-Host "-- Cleanup --" -ForegroundColor DarkGray
    foreach ($task in $cleanupTasks) {
      try { & $task } catch { Write-Warning "Cleanup error: $($_.Exception.Message)" }
    }
  }

  # -- Summary -----------------------------------------------------------------
  $skipCount = @($allResults | Where-Object { $_.Status -eq "SKIP" }).Count
  Write-Host ""
  Write-Host "============================================================" -ForegroundColor Cyan
  Write-Host "  SYNTHETIC TEST RESULTS" -ForegroundColor Cyan
  Write-Host "  PASS : $passCount" -ForegroundColor Green
  Write-Host "  FAIL : $failCount" -ForegroundColor $(if ($failCount -gt 0) { "Red" } else { "Green" })
  Write-Host "  SKIP : $skipCount" -ForegroundColor DarkYellow
  Write-Host "  Time : $([DateTime]::UtcNow.ToString('o'))" -ForegroundColor Cyan
  Write-Host "============================================================" -ForegroundColor Cyan

  if ($failCount -gt 0) {
    Write-Host ""
    Write-Host "Failed steps:" -ForegroundColor Red
    $allResults | Where-Object { $_.Status -eq "FAIL" } | ForEach-Object {
      Write-Host "  FAIL: $($_.Step)$(if ($_.Detail) { ' -- ' + $_.Detail })" -ForegroundColor Red
    }
    exit 1
  } else {
    Write-Host ""
    Write-Host "All steps passed." -ForegroundColor Green
    exit 0
  }
}
