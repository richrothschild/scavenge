# SCAVENGE Production Runbook (Railway + Managed Postgres)

## 1) Prerequisites

- Railway account with two services:
  - `scavenge-backend` (Dockerfile: `backend/Dockerfile`)
  - `scavenge-web` (Dockerfile: `admin/Dockerfile`)
- Managed PostgreSQL instance (Railway Postgres plugin or external)
- DNS access for temporary subdomains

## 2) Environment variables (backend)

Set these on Railway backend service:

- `NODE_ENV=production`
- `PORT=3001`
- `PERSISTENCE_MODE=postgres`
- `SEED_VARIANT=test` (use test clues) or `SEED_VARIANT=production` (use production clues)
- `DATABASE_URL=<managed_postgres_url>`
- `JWT_SECRET=<long-random-secret>`
- `ADMIN_PASSWORD=<strong-admin-password>`
- `AI_PROVIDER=mock` (switch to `openai` when API key is ready)
- `OPENAI_API_KEY=<optional for now>`
- `OPENAI_MODEL=gpt-4o`
- `SOCKET_CORS_ORIGIN=https://www.boyzweekend.org,https://boyzweekend.org,https://scavenge-web-production.up.railway.app`
- `RATE_LIMIT_JOIN_WINDOW_MS=300000`
- `RATE_LIMIT_JOIN_MAX=30`
- `RATE_LIMIT_ADMIN_LOGIN_WINDOW_MS=600000`
- `RATE_LIMIT_ADMIN_LOGIN_MAX=10`
- `RATE_LIMIT_SCAN_VALIDATE_WINDOW_MS=60000`
- `RATE_LIMIT_SCAN_VALIDATE_MAX=20`
- `RATE_LIMIT_SUBMIT_WINDOW_MS=300000`
- `RATE_LIMIT_SUBMIT_MAX=10`

## 3) Environment variables (web)

Set on Railway web service:

- `VITE_API_BASE_URL=https://api.boyzweekend.org/api`

Canonical app/admin URL:

- `https://www.boyzweekend.org`
- `https://www.boyzweekend.org/admin`

If apex forwarding is enabled, note that some DNS-forwarding providers do not preserve path segments reliably. Keep `https://www.boyzweekend.org/admin` as the canonical admin route.

For Expo/mobile clients, set in the mobile app environment:

- `EXPO_PUBLIC_API_BASE_URL=https://<backend-domain>/api`

## 4) Database migration order

Run against production database in order:

1. `backend/migrations/001_initial.sql`
2. `backend/migrations/002_runtime_state.sql`
3. `backend/migrations/003_remove_sabotage.sql` — drops sabotage tables and `teams.sabotage_balance`

## 5) Seed data

From a shell with production env vars set:

- `npm run seed -w backend`

## 6) Smoke tests

- `GET /api/health` returns `{ ok: true }`
- `POST /api/auth/join` works with seed join code + captain pin
- `GET /api/team/me/state` returns active clue
- `POST /api/team/me/scan-session` and `POST /api/team/me/scan-validate` succeed
- `POST /api/team/me/submit` produces verdict
- `GET /api/admin/review-queue` works after admin login

Quick script (from repo root):

- `setx ADMIN_PASSWORD "<admin-password>"` (new shell required), or set `$env:ADMIN_PASSWORD` for current shell
- `npm run smoke:prod -w backend`

Optional overrides:

- `powershell -ExecutionPolicy Bypass -File backend/scripts/smoke-prod.ps1 -BaseUrl "https://api.boyzweekend.org/api" -WebUrl "https://www.boyzweekend.org" -ExpectedCorsOrigin "https://www.boyzweekend.org" -AdminPassword "<admin-password>"`

Synthetic checks:

- `npm run synthetic:prod -w backend`

Canary user-journey checks (production-safe with automatic cleanup):

- `npm run journey:prod -w backend`

Optional overrides:

- `powershell -ExecutionPolicy Bypass -File backend/scripts/journey-prod.ps1 -BaseUrl "https://api.boyzweekend.org/api" -WebUrl "https://www.boyzweekend.org" -AdminSecret "<admin-password>" -CanaryTeamId "spades"`

## 7) Launch checklist

- Confirm all captains can log in with final PINs
- Rotate demo PINs and join codes before event
- Set `AI_PROVIDER=openai` and verify verdict path
- Confirm screenshot/security alerts appear in admin panel
- Confirm leaderboard updates in real time

## 8) Rollback

- Re-deploy previous Railway release for backend and web
- Restore latest DB snapshot if data corruption is suspected
- If needed, set `PERSISTENCE_MODE=memory` only for emergency read/demo mode

## 9) CI Deployment Gate

- CI now runs tests, build, Playwright e2e, and production smoke checks.
- Set `PROD_ADMIN_PASSWORD` as a GitHub Actions secret.
- Use GitHub's built-in Actions notifications for failure alerts (no external webhook secret required).
- Require the CI workflow as a branch protection check on `main` so production promotion is blocked unless smoke checks pass.
- Scheduled monitors:
  - `Synthetic Prod Checks` runs every 10 minutes (`*/10 * * * *`) for fast availability detection.
  - `Canary Prod Journey` runs hourly (`0 * * * *`) and validates admin/player journey endpoints with automatic canary cleanup.
  - `Canary Prod Journey` opens or updates a GitHub issue automatically when the monitor fails, and closes that issue automatically after a successful recovery run.
