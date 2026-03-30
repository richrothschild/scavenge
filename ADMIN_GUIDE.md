# Boyz Weekend 2026 — Admin (Dictator) Guide

> This guide covers everything you need to run the hunt on April 11, 2026.
> The admin console is at **boyzweekend.org** — switch to Admin mode from the top of the page.

---

## Table of Contents

1. [Before Hunt Day — Setup](#1-before-hunt-day--setup)
2. [Day-of Checklist](#2-day-of-checklist)
3. [Starting the Hunt](#3-starting-the-hunt)
4. [Live Ops Reference](#4-live-ops-reference)
   - [Dashboard & Auto-Refresh](#dashboard--auto-refresh)
   - [Game Status Controls](#game-status-controls)
   - [Leaderboard](#leaderboard)
   - [Review Queue](#review-queue)
   - [Security Events](#security-events)
   - [Deduct Points](#deduct-points)
   - [Reopen a Clue](#reopen-a-clue)
   - [Audit Log](#audit-log)
   - [Realtime Event Feed](#realtime-event-feed)
5. [Common Errors & How to Fix Them](#5-common-errors--how-to-fix-them)
6. [Reference: Teams & Join Codes](#6-reference-teams--join-codes)
7. [Emergency Procedures](#7-emergency-procedures)

---

## 1. Before Hunt Day — Setup

### Logging In

1. Open the app in a browser and tap **Admin** at the top of the page.
2. Enter your admin password and tap **Login Admin**.
3. You'll see two tabs: **Setup** and **Live Ops**. Stay on Setup until the day of.

### Assigning Players to Teams

Before players arrive, or as they check in on hunt morning:

1. Go to **Setup → Team Assignments**.
2. Select a team from the dropdown (SPADES, HEARTS, DIAMONDS, CLUBS).
3. Type the player's name exactly as they'll enter it in the app.
4. Tap **Assign To Team**.
5. Repeat for every player. Each player's name pill appears below the team card.
6. To remove a player, click the **✕** on their name pill.

> **Important:** Players must join the app using the exact name you assigned, or the backend won't recognize them. Names are case-sensitive.

### Assigning Captains

After players are assigned to teams:

1. Go to **Setup → Captain Assignment**.
2. Select the team from the first dropdown.
3. Select the captain's name from the second dropdown (only players already assigned to that team appear here).
4. Enter their **6-digit captain PIN**.
5. Tap **Assign Captain + PIN**.

Captain PINs for production:

| Team | Captain | PIN |
|------|---------|-----|
| SPADES | Lars | 910546 |
| HEARTS | Carl | 609814 |
| DIAMONDS | Rich | 406932 |
| CLUBS | Dave | 409523 |

> If the captain dropdown shows no names, you haven't assigned any players to that team yet. Do that first, then come back.

> To reassign a captain after the game is already RUNNING, check the **Allow reassignment while RUNNING (force override)** box before submitting.

### Verifying Setup

After all players and captains are assigned, tap **Refresh Assignments** to reload the grid. Each team card should show:
- Captain name and PIN
- All assigned players

---

## 2. Day-of Checklist

Run through this at the Zephyr Hotel before 10:00 AM.

- [ ] Log in to admin console
- [ ] Open **Setup** — verify all 4 teams show correct captain and players
- [ ] Switch to **Live Ops** — tap **Refresh Admin Dashboard** to confirm it loads data
- [ ] Confirm **Game Status** reads **PENDING**
- [ ] Confirm **Realtime Socket** checkbox is checked (green dot in event feed)
- [ ] Brief each captain: they open the app, enter their team join code, enter their name, enter their captain PIN
- [ ] Confirm each captain can see clue 1 in their app before you start the hunt

---

## 3. Starting the Hunt

### Normal Start (Use This on Hunt Day)

1. Switch to **Live Ops**.
2. Under **Game Status**, tap **Start / Run**.
3. Status updates to **RUNNING**.
4. Announce "Go!" — all teams can now submit answers.

> **Do not use "Start Test Hunt" on hunt day.** That button resets all data and restarts the backend. It's only for testing the app before the real hunt.

### Pausing the Hunt

Tap **Pause** under Game Status. All teams see a "game paused" state — submits are blocked. Use this if there's a serious dispute, emergency, or if you need to make a correction across teams. Resume with **Start / Run**.

### Ending the Hunt

Tap **End** when the last team finishes or time is called. The leaderboard freezes. Scores are final.

---

## 4. Live Ops Reference

### Dashboard & Auto-Refresh

The Live Ops control bar at the top of the page has:

| Control | What it does |
|---------|-------------|
| **Refresh Admin Dashboard** | Reloads all panels at once (leaderboard, review queue, security events, audit log, game status) |
| **Load Review Queue** | Reloads just the review queue |
| **Load Security Events** | Reloads just security events |
| **Load Audit Logs** | Reloads just audit logs |
| **Load Leaderboard** | Reloads just the leaderboard |
| **Load Game Status** | Reloads just game status |
| **Clear Team Context** | Clears all the team-scoped filters and form fields at once |
| **Auto Refresh** checkbox | Polls all panels automatically on the interval below (default 10 seconds) |
| **Realtime Socket** checkbox | Subscribes to push events — review queue alerts, security alerts, leaderboard updates |
| **Poll seconds** field | How often auto-refresh fires (minimum 3 seconds) |

**Recommendation:** Leave both **Auto Refresh** and **Realtime Socket** enabled during the hunt. This way you receive push notifications the moment a team submits something that needs review, and the leaderboard stays current.

---

### Game Status Controls

Shows the current status (PENDING / RUNNING / PAUSED / ENDED) and the game name/timezone.

| Button | Effect |
|--------|--------|
| **Start Test Hunt** | Resets to test clues, restarts the backend, starts game. **Hunt-day: do not use.** |
| **Set Pending** | Rolls back to pre-start state. Blocks submits. |
| **Start / Run** | Starts or resumes the game. Enables submits. |
| **Pause** | Freezes submits. Teams can still see their current clue. |
| **End** | Ends the hunt. Scores are final. |

---

### Leaderboard

Shows all 4 teams with current score, current clue number, and completed/skipped counts. Updates automatically when Auto Refresh or Realtime Socket fires.

**Load Team Context** button on each row: pre-fills the team ID into the Deduct Points form, Reopen Clue form, and Review Queue filter all at once — saves time when you need to quickly act on a specific team.

---

### Review Queue

Shows submissions that the AI couldn't confidently accept or reject (verdict: NEEDS_REVIEW). These require your judgment.

Each item shows:
- **Team / Clue number / Time submitted**
- **Text answer** (if they typed one)
- **Photo thumbnail** (if they uploaded a photo — click it to open full size)
- **AI score and reasoning** — the AI's confidence and what it found or didn't find

**To resolve:**

- Tap **Pass** → awards full base points (or a custom amount if you fill in the **PASS points override** field above the list)
- Tap **Fail** → awards 0 points; the team can resubmit

**Custom points:** If you want to award partial credit, enter the point amount in the **PASS points override** field before tapping Pass.

**Filtering:** Type a team ID (e.g., `spades`) in the team filter box to see only that team's submissions.

**Pagination:** Use First / Prev / Next / Last to page through if the queue is long. The limit and offset fields control page size and starting position.

---

### Security Events

Lists screenshot-attempt events detected by the app. Each event shows team, clue number, event type, and timestamp.

The **Deduct Points** button next to each event pre-fills the deduction form with that team's ID and a default reason of "Security event: SCREENSHOT_ATTEMPT" — tap it, enter an amount, and submit.

**Scope to review team filter:** When checked, the security events list is filtered to the same team as the Review Queue filter. Useful for investigating a specific team.

---

### Deduct Points

Use this to penalize a team for cheating, a screenshot violation, or an admin correction.

| Field | Notes |
|-------|-------|
| **Team id** | Lowercase team name: `spades`, `hearts`, `diamonds`, `clubs` |
| **Amount** | Positive number. Points are subtracted from team score. |
| **Reason** | Required. Appears in the audit log. Be specific. |

After submitting, the leaderboard and audit log reload automatically.

> **Tip:** Use the **Load Team Context** button from the leaderboard to pre-fill the team ID before opening the deduction form.

---

### Reopen a Clue

Use this when a team accidentally passed a clue, when there was a QR scan failure, or when you want to give a team a second chance on a submission.

| Field | Notes |
|-------|-------|
| **Team id** | Lowercase: `spades`, `hearts`, etc. |
| **Clue index** | Zero-based. Clue 1 = index 0, Clue 2 = index 1, etc. |
| **Duration seconds** | How long to hold the clue open. 300 = 5 minutes. Leave the window open — you'll close it manually by letting it expire or by using Reopen again. |
| **Reason** | Required. Logged in audit trail. |

**Quick reopen:** In the Leaderboard section, the **Prepare Reopen** button on each team row pre-fills the Reopen form with that team's ID and their previous clue index (current - 1).

After reopening, the team's captain will see the clue become active again in their app. When the duration expires the clue locks automatically.

---

### Audit Log

A full record of every admin action: point deductions, captain assignments, clue reopens, QR rotations, game status changes.

**Filtering:**
- **Action filter:** e.g., `POINTS_DEDUCTED`, `CLUE_REOPENED`, `CAPTAIN_ASSIGNED`
- **Team/target filter:** e.g., `spades`

Use First / Prev / Next / Last buttons to page through. The limit and offset fields control page size.

---

### Realtime Event Feed

At the bottom of Live Ops, the **Realtime Events** log shows every socket event as it arrives: leaderboard updates, submission alerts, security alerts, disconnects. Useful for confirming the realtime connection is healthy and for seeing the chronological sequence of events during the hunt.

---

## 5. Common Errors & How to Fix Them

### "The area below Setup/Live Ops disappeared after I logged in"

Your session expired mid-page or something refreshed the token. Log out and log back in. The page will reload correctly.

---

### "Nothing loads when I switch to Live Ops"

The page loads data when you enter Live Ops. If it appears empty:
1. Tap **Refresh Admin Dashboard** — this force-loads all panels.
2. If that shows nothing, check your admin login — look at the top of the page for the lock icon. If you're not logged in, the panels won't show.

---

### "Add Player button does nothing / players don't appear"

This usually means your admin session expired while you were on the page. The button's request silently fails with 401.

**Fix:**
1. Scroll up and log in again with your admin password.
2. Switch to Setup — the team assignment grid will reload.
3. Your previously assigned players will appear again.

---

### "The Captain dropdown is empty when I try to assign a captain"

You haven't assigned any players to that team yet. Go to the Team Assignments form, add at least one player to the team, then return to Captain Assignment. The dropdown will populate.

---

### "I hit Start Hunt and now players see 'not connected'"

You likely hit **Start Test Hunt** instead of **Start / Run**. Start Test Hunt restarts the backend, which disconnects all players and wipes their sessions.

**Fix:**
1. Wait ~30 seconds for the backend to come back up.
2. Ask all players to close and reopen the app and re-enter their team join code and name. Their session will be fresh.
3. The game should already be RUNNING — check Live Ops to confirm.

Going forward, use **Start / Run** to start or resume the game. Only use **Start Test Hunt** when testing before the real hunt.

---

### "A player says they submitted but I don't see it in the review queue"

The AI probably gave an instant verdict (PASS or FAIL) and it never entered the queue. NEEDS_REVIEW items are the only ones that appear here. Check the audit log for that team to see the full submission history. Filter by their team ID.

---

### "A player's app shows an old clue / wrong clue"

The player's phone may be cached. Tell them to:
1. Tap **Tap to load** on the clue panel to force a server refresh.
2. If that doesn't help, close and reopen the app.

If the issue persists on the backend side (i.e., their clue index is wrong in the leaderboard), use Reopen Clue to reset them to the correct clue index.

---

### "A player says 'Your session expired — please rejoin the hunt'"

Their session token was invalidated, most likely because you used Start Test Hunt (which restarts the backend and wipes in-memory sessions). They need to rejoin:
1. Close the app.
2. Re-enter their team join code and name.
3. If they're a captain, re-enter their captain PIN.
4. They'll resume at their team's current clue.

---

### "A team accidentally passed a clue they didn't mean to skip"

Use **Reopen a Clue**:
1. In the Leaderboard, click **Prepare Reopen** on that team row — this pre-fills the form.
2. Set duration to something reasonable (e.g., 600 = 10 minutes).
3. Enter a reason (e.g., "Accidental pass — team requested review").
4. Submit.
5. The team's captain will see the clue re-activate in their app immediately.

---

### "The review queue shows a photo but it's broken / won't load"

The photo URL may reference a media storage URL that's expired or unreachable. Try clicking the thumbnail to open it in a new tab. If it fails, contact the team and ask them to resubmit. You can use **Reopen Clue** to let them re-submit if the AI closed the window.

---

### "A team is clearly cheating (sharing answers / looking up clues)"

1. Take note of the team ID.
2. Apply a point deduction via **Deduct Points** with a detailed reason.
3. All deductions are permanent and logged in the audit trail.
4. If it's egregious, **End** the hunt or pause it while you sort it out.

---

### "I need to change a captain mid-hunt"

1. Go to **Setup → Captain Assignment**.
2. Select the team.
3. Select the new captain's name from the dropdown.
4. Enter a new PIN (tell the new captain this PIN in person).
5. Check **Allow reassignment while RUNNING (force override)**.
6. Tap **Assign Captain + PIN**.

The new captain will be active immediately. The old captain's app will show MEMBER status on their next refresh.

---

## 6. Reference: Teams & Join Codes

| Team | Join Code | Captain | PIN |
|------|-----------|---------|-----|
| Alcatraz Aces (SPADES) | SPADES-AJ29LN | Lars | 910546 |
| Golden Gate Hearts (HEARTS) | HEARTS-GXQZ5F | Carl | 609814 |
| Cable Car Diamonds (DIAMONDS) | DIAMONDS-4AFYXZ | Rich | 406932 |
| Haight Clovers (CLUBS) | CLUBS-D2Y7IG | Dave | 409523 |

**How players join:**
1. Open the app.
2. Tap a team join code to select the team.
3. Enter their first name exactly as you assigned them.
4. Captains: enter the 6-digit PIN when prompted.
5. Members: tap Join without a PIN.

---

## 7. Emergency Procedures

### Backend is down / all players see errors

1. Check the Railway dashboard for the backend service status.
2. If the backend crashed, Railway auto-restarts it within ~30 seconds.
3. After it comes back, players may need to close and reopen the app to reconnect.
4. You'll need to log in to the admin console again (sessions are in-memory).
5. Once logged in and on Live Ops, the dashboard reloads automatically.

### You need to completely reset the hunt (testing only)

Tap **Start Test Hunt** in Live Ops. Confirm the dialog. This:
1. Reloads the test seed (6 short South Bay clues)
2. Restarts the backend (all sessions wiped)
3. Marks the game RUNNING

After this, every player must rejoin. Do not use this during the real hunt.

### You lost the admin password

The admin password is `1017`. If Railway environment variables were changed, check the `ADMIN_PASSWORD` variable in the Railway backend service settings.

### A team's score is wildly wrong

1. Open the **Audit Log** in Live Ops and filter by that team's ID.
2. Look for unexpected point awards or deductions.
3. Use **Deduct Points** (positive or negative amount — negative values add points back) to correct the score.
4. Note: there is no "award points" button separately — a negative deduction adds points.

### Hunt needs to be paused for an extended break

Tap **Pause**. Players see a paused state and cannot submit. When you're ready to resume, tap **Start / Run**. All progress is preserved.
