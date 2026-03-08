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
- `DATABASE_URL=<managed_postgres_url>`
- `JWT_SECRET=<long-random-secret>`
- `ADMIN_PASSWORD=<strong-admin-password>`
- `AI_PROVIDER=mock` (switch to `openai` when API key is ready)
- `OPENAI_API_KEY=<optional for now>`
- `OPENAI_MODEL=gpt-4o`
- `SOCKET_CORS_ORIGIN=<admin-web-url>`

## 3) Environment variables (web)

Set on Railway web service:

- `VITE_API_BASE_URL=https://<backend-domain>/api`

For Expo/mobile clients, set in the mobile app environment:

- `EXPO_PUBLIC_API_BASE_URL=https://<backend-domain>/api`

## 4) Database migration order

Run against production database in order:

1. `backend/migrations/001_initial.sql`
2. `backend/migrations/002_runtime_state.sql`

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

- `powershell -ExecutionPolicy Bypass -File backend/scripts/smoke-prod.ps1 -BaseUrl "https://<backend-domain>/api" -AdminPassword "<admin-password>"`

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
