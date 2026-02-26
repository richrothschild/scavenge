# SCAVENGE — Claude Code Project Reference

> Boyz Weekend 2026 Scavenger Hunt Mobile App · San Francisco

---

## PROJECT OVERVIEW

**Scavenge** is a real-time, team-based scavenger hunt app built for 4 teams of ~4 men (ages ~60s) racing across San Francisco on Saturday, April 11, 2026. The hunt starts at the Zephyr Hotel near Pier 39 and ends at the Buena Vista Bar.

The app handles QR check-ins, AI-judged photo/video submissions, a live leaderboard, a sabotage economy, and captain-only team actions — all synchronized in real time across all team members' devices.

---

## REPO STRUCTURE (MONOREPO)

```
scavenge/
├── CLAUDE.md                  ← This file
├── PROJECT_STATE.md           ← Live build status
├── SESSION_LOG.md             ← Work history
├── docker-compose.yml
├── .env.example
├── shared/                    ← Shared types, constants, utils
│   ├── types/
│   └── constants/
├── backend/                   ← Node.js + Express + Socket.IO
│   ├── src/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── models/
│   │   ├── middleware/
│   │   └── realtime/
│   ├── migrations/
│   ├── seed/
│   └── tests/
├── mobile/                    ← React Native (Expo)
│   ├── src/
│   │   ├── screens/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── context/
│   │   └── services/
│   └── tests/
└── admin/                     ← React web (Vite)
    ├── src/
    │   ├── pages/
    │   ├── components/
    │   └── hooks/
    └── tests/
```

---

## TECH STACK

| Layer | Choice |
|---|---|
| Mobile | React Native (Expo SDK 51+) |
| Admin Console | React + Vite |
| Backend | Node.js + Express |
| Realtime | Socket.IO |
| Database | PostgreSQL (SQLite for local dev only) |
| Media Storage | S3-compatible (or Firebase Storage) |
| Auth | Join codes + Captain PIN + Admin password |
| AI Judging | OpenAI API (pluggable provider interface) |
| QR Validation | Short-lived JWT scan session tokens (60–180s) |
| Containerization | Docker Compose |

---

## KEY COMMANDS

```bash
# Install all dependencies (from root)
npm install

# Run backend dev server
cd backend && npm run dev

# Run mobile (Expo)
cd mobile && npx expo start

# Run admin console
cd admin && npm run dev

# Run DB migrations
cd backend && npm run migrate

# Seed database (includes 2 test clues + teams)
cd backend && npm run seed

# Run all tests
npm run test

# Docker (full stack)
docker-compose up --build
```

---

## HUNT LOGISTICS (HARD CONSTRAINTS)

- **Start:** Zephyr Hotel, near Pier 39, San Francisco, CA
- **Start time:** Saturday, April 11, 2026 at 10:00 AM (America/Los_Angeles)
- **End:** Buena Vista Bar, San Francisco, CA
- **Total clues:** 12 (linear, ordered per team)
- **Teams must complete:** ≥7 clues to be eligible for winning
- **Max skips:** 5 optional clues may be passed

### Required Transport Steps (CANNOT be skipped)
1. Walk sequence from Zephyr (early clues)
2. **Waymo** to 1083 Lombard Street (REQUIRED clue)
3. **Cable car** to Buena Vista Bar (REQUIRED clue)
4. **Final two clues** at Buena Vista Bar (both REQUIRED)

---

## TEAMS & CAPTAINS

| Team | Captain |
|---|---|
| Spades | Lars |
| Hearts | Carl |
| Diamonds | Rich |
| Clubs | Dave |

- Captain-to-team mapping is configurable in Admin console
- Exactly ONE captain per team enforced at all times
- Only captains can: submit answers, upload proof, choose PASS, trigger sabotage

---

## ROLE PERMISSIONS

### Member (non-captain)
- Read-only: current clue, rules, leaderboard, sabotage history, event feed, notifications
- May scan QR (configurable by Admin; default: YES)
- Cannot submit, pass, or trigger sabotage

### Captain
- Everything a member can see
- Submit photo/video/text proof
- Pass (skip) a clue
- Purchase/trigger sabotage actions
- Confirm QR check-in (if required before submission)

### Admin (Game Master)
- Full game configuration and live monitoring
- Start / Pause / End game
- Reopen prior clues (with reason + duration)
- Override AI judgments
- Deduct points for screenshot violations or cheating
- Revoke/rotate QR public IDs or invalidate scan tokens

---

## CLUE PROGRESSION RULES

1. Progression is **strictly per team** — all members always see the same clue
2. Backend holds a single `current_clue_index` per team (0–11)
3. Captain SUBMIT or PASS → backend increments index → Socket.IO broadcasts to all team devices
4. Previous clue becomes **locked** after advancing (inaccessible unless Admin reopens)
5. REQUIRED clues cannot be passed — reject with clear error message
6. OPTIONAL clues may be passed (consumes one of max 5 skips)
7. QR scans for future clues are **rejected by the server**

### Eligibility
- `completed_count >= 7` → **ELIGIBLE**
- `completed_count < 7` at game end → **INELIGIBLE** (score shown but flagged)

---

## QR CODE "LIVENESS" FLOW

```
1. App requests "Scan Session Token" from backend for team's CURRENT clue
2. User scans physical QR code (contains checkpoint_public_id)
3. App sends { checkpoint_public_id, scan_session_token } to backend
4. Backend validates:
   - scan_session_token: matches team + current clue + not expired (60–180s) + game running
   - checkpoint_public_id: correct for current clue
5. On success: scan event recorded; captain must confirm/submit to advance
```

- Admin can revoke tokens or rotate QR public IDs (anti-cheat)
- Printed QR backups allowed; liveness enforced via server token

---

## AI JUDGING

Provider interface must be pluggable (OpenAI default). AI returns:

```json
{
  "verdict": "PASS" | "FAIL" | "NEEDS_REVIEW",
  "score": 0-100,
  "reasons": ["bullet 1", "bullet 2"],
  "safety_flags": ["NONE"],
  "notes_for_admin": "short note"
}
```

- **PASS** → awards points (with bonus tiers)
- **FAIL** → 0 points; captain may resubmit while clue is active (unless Admin locks after X tries)
- **NEEDS_REVIEW** → queued for admin; no points until resolved

---

## SABOTAGE ECONOMY

- Points-as-currency system
- Captain-only to trigger; members can view store and event feed read-only
- Each sabotage action has: cost, cooldown, target, effect
- Seed data must include a basic catalog (3–5 actions minimum)
- All purchases/triggers logged in event feed

---

## SCREENSHOT DETECTION

Best-effort on both platforms:

- **iOS:** Subscribe to screenshot event listeners where available
- **Android:** Apply `FLAG_SECURE` to clue screens; detect attempts where possible

On detection while viewing a clue screen:
1. Create `SecurityEvent { team_id, participant_id, type: SCREENSHOT_ATTEMPT, timestamp, device_info, clue_id }`
2. Emit realtime alert to Admin console via Socket.IO
3. Optionally show in team event feed: "A security event was detected" (no name shown)

Admin response: "Deduct points" button with required reason + amount → logged in audit log + team feed.

---

## ADMIN REOPEN CLUE MECHANISM

- Admin can reopen last clue OR any prior clue from team's history
- Duration: until manually re-locked OR for specified window (e.g., 5 minutes)
- Reason note is **required** and stored in audit log
- Audit log records: who reopened, which clue, timestamps, reason, any point changes
- On closure: clue locks again; captain can resubmit within the window

---

## DATA MODEL SUMMARY

```
Game: id, name, start_time, end_time, timezone, status, admin_password_hash

Team: id, name (SPADES/HEARTS/DIAMONDS/CLUBS), join_code, captain_name,
      captain_pin_hash, score_total, sabotage_balance, current_clue_index,
      completed_count, skipped_count, eligibility_status

Participant: id, team_id, display_name, role (CAPTAIN/MEMBER), device_info

Clue: id, order_index (1-12), title, instructions, required_flag, transport_mode
      (WALK/WAYMO/CABLE_CAR/NONE), requires_scan, submission_type (PHOTO/VIDEO/TEXT/NONE),
      ai_rubric, base_points, qr_public_id, lock_after_advance

TeamClueState: id, team_id, clue_id, status (LOCKED/ACTIVE/COMPLETED/PASSED),
               scan_validated, submissions_count, points_awarded, opened_by_admin_until

Submission: id, team_id, clue_id, participant_id, media_url, text_content,
            ai_verdict, ai_score, ai_reasons, ai_safety_flags, admin_override,
            points_awarded, created_at

SecurityEvent: id, team_id, participant_id, type (SCREENSHOT_ATTEMPT/...),
               timestamp, device_info, clue_id

AuditLog: id, actor_type (ADMIN/SYSTEM), actor_id, action, target_type,
          target_id, reason, metadata, created_at

SabotageAction: id, name, description, cost, cooldown_seconds, effect_type, effect_value

SabotagePurchase: id, team_id, action_id, triggered_by, target_team_id,
                  cost_deducted, created_at

ScanSessionToken: id, team_id, clue_id, token_hash, expires_at, used, created_at
```

---

## SEED DATA

Seed must include:
- Game settings (name: "Boyz Weekend 2026", start: 2026-04-11 10:00 AM PT)
- 4 teams with join codes + captain PINs (printed in seed output)
- 12 clue placeholders (locations TBD by user — use `[LOCATION_TBD]` placeholders)
- 2 test clues (see below)
- Basic sabotage catalog (3–5 actions)

### Test Clue A — "Giants Proof" (OPTIONAL, base 100pts)
Find something within walking distance showing the SF Giants (logo, signage, apparel, or display).
Photo must include: (1) Giants reference, (2) all 4 team members, (3) visible SF landmark.
**AI PASS criteria:** Giants reference unambiguous + all 4 members visible + SF context confirmed.

### Test Clue B — "49ers Proof" (OPTIONAL, base 120pts)
Record 10–20 second video of team doing a 49ers-themed moment (chant, pose, touchdown celebration).
Must include: (1) phrase "Boyz Weekend 2026" spoken, (2) all 4 members, (3) SF tie-in.
**AI PASS criteria:** Duration met + phrase spoken + all members + 49ers theme clear.

> ⚠️ Do NOT invent physical locations for test clues. Leave as `[LOCATION_TBD]`.

---

## MOBILE APP SCREENS

1. **Join / Team Select** — Game code → team → display name → captain PIN (optional)
2. **Team Home** — Current clue card, progress (X/12, skips used, must-complete remaining), eligibility badge
3. **Current Clue** — Clue text + transport instructions; captain: SUBMIT / PASS / Confirm Check-in buttons
4. **QR Scanner** — Request scan token → scan QR → send to server
5. **Submission Viewer** — View submitted proof + AI verdict (all members); captain can create
6. **Leaderboard** — Live rank, score, completed, skips used, current clue, eligibility badge
7. **Sabotage Store** — Members: read-only; Captain: buy/trigger; event feed
8. **Event Feed** — Progress events, sabotage actions, admin actions, security events
9. **End Screen** — Final standings + winner announcement

---

## ADMIN CONSOLE SCREENS

**Setup:**
- Create/edit game (name, times, timezone)
- Teams: assign captain name + PIN per team
- Clue editor: 12 clues in order (required/optional, transport mode, QR id, rubric, points)
- Generate printable QR PDF + show QR on-screen backup

**Live Ops:**
- Start / Pause / End game controls
- Live leaderboard with team drill-down
- Security events panel (screenshot alerts) + "Deduct points" action
- Submission review queue (NEEDS_REVIEW verdicts)
- Override AI verdict / adjust points
- Reopen prior clue (select clue, set duration, enter reason)
- Revoke/rotate QR public IDs or invalidate scan tokens

---

## REALTIME EVENTS (Socket.IO)

| Event | Trigger | Receivers |
|---|---|---|
| `team:clue_advanced` | Submit or Pass | All team members |
| `leaderboard:updated` | Score change | All connected clients |
| `security:screenshot_alert` | Screenshot detected | Admin console |
| `submission:verdict_ready` | AI or Admin verdict | Team members |
| `sabotage:triggered` | Sabotage action | Target team + all |
| `admin:clue_reopened` | Admin reopens clue | Team members |
| `game:status_changed` | Start/Pause/End | All connected clients |

All scoring/progression events must reflect on leaderboard within **2 seconds**.

---

## ACCEPTANCE CRITERIA

- [ ] Team progression is team-synced; all members always see the same clue
- [ ] Only captains can submit, pass, or trigger sabotage
- [ ] Teams can pass up to 5 OPTIONAL clues; REQUIRED clues cannot be passed
- [ ] Teams must complete ≥7 clues to be eligible; shown on leaderboard
- [ ] After advancing, previous clue is inaccessible unless Admin reopens
- [ ] Admin reopen mechanism works and every reopen is audited
- [ ] Screenshot detection triggers Admin alert and logs SecurityEvent
- [ ] Admin can deduct points; deduction appears in audit log + team feed
- [ ] QR check-ins use short-lived server tokens and are server-validated
- [ ] Future clue QR scans are rejected
- [ ] Realtime leaderboard updates within 2 seconds
- [ ] Sabotage actions enforce cooldowns and are captain-only to trigger
- [ ] AI judging uses pluggable provider interface
- [ ] All 4 teams, 12 clue placeholders, and 2 test clues exist in seed data

---

## BUILD PHASES

| Phase | Goal |
|---|---|
| **0** | Confirm spec + generate seed config (JSON/YAML) |
| **1** | Architecture + repo scaffolding + OpenAPI contract + DB migrations |
| **2** | Backend MVP (auth, team state, QR tokens, AI judging, scoring, sabotage, Socket.IO) |
| **3** | Mobile MVP (role-based UI, QR scanner, submissions, screenshot detection, leaderboard) |
| **4** | Admin console (setup wizard, live dashboard, overrides, reopen, deductions) |
| **5** | Testing (unit, integration, realtime, security event pathway) |
| **6** | Docker + Expo builds + env templates + runbook |

---

## WHAT'S STILL NEEDED FROM USER

- The actual 12 clues (titles, text, locations, required/optional designation)
- Exact walking checkpoints and which clue index triggers Waymo / cable car
- Custom sabotage actions and point tuning
- Final captain PINs and join codes (or confirm auto-generated ones from seed)

---

## ENVIRONMENT VARIABLES (see .env.example)

```
DATABASE_URL=
JWT_SECRET=
SCAN_TOKEN_EXPIRY_SECONDS=120
S3_BUCKET=
S3_REGION=
S3_ACCESS_KEY=
S3_SECRET_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o
ADMIN_PASSWORD=
PORT=3001
SOCKET_CORS_ORIGIN=
```
