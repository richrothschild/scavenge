# SCAVENGE — Project State

Last updated: 2026-03-16

## Current Status: 🟡 PHASE 3 IN PROGRESS — production backend/web now deployed with Postgres persistence; mobile API shell remains in progress

## Phase Progress

| Phase | Status | Notes |
|---|---|---|
| 0 – Spec + Seed Config | ✅ COMPLETE | Clues finalized and seed-config updated |
| 1 – Architecture + Repo | ✅ COMPLETE | Monorepo scaffold, Expo/Vite bootstrap, OpenAPI + initial migration |
| 2 – Backend MVP | ✅ COMPLETE | Auth/team state, QR flow, runtime persistence, AI verdict/review, sabotage, security, admin actions |
| 3 – Mobile MVP | 🟡 IN PROGRESS | Expo app includes join/state/leaderboard/submit/pass/QR, sabotage store, security report, team event feed, and submission history wiring |
| 4 – Admin Console | ✅ COMPLETE | Dedicated admin experience now implemented in `/admin` with Setup + Live Ops (review/security/reopen/deduction/status, token/QR controls, realtime + pagination) |
| 5 – Testing | ✅ COMPLETE | CI now includes build/test, Playwright e2e, and production smoke gate; synthetic checks scheduled and passing |
| 6 – Deployment | ✅ COMPLETE | Railway web + backend deployed on custom domains, managed Postgres provisioned, migrations/seed executed, smoke + synthetic checks green |

## Blocking Items

- [x] Confirm final point values for all clues (total 1,590; required transport/final clues weighted)
- [x] Confirm sabotage catalog (5 actions retained for event-friendly gameplay)
- [x] Confirm final captain PIN policy (team-specific 6-digit event PINs in seed config)
- [ ] Expand backend integration coverage beyond baseline suite (core endpoint tests now added)
- [x] Run PostgreSQL migrations + seed in target environment and validate persistence mode
- [x] Complete dedicated Admin Console UX (Setup + Live Ops now covers operational controls)
- [x] Execute Railway production deployment with real credentials and domains

## Critical Files

- `CLAUDE.md` — Primary project reference (auto-loaded)
- `backend/migrations/` — DB schema
- `backend/seed/` — Game + team + clue seed data
- `shared/types/` — Shared TypeScript interfaces

## Known Decisions

- React Native (Expo) for mobile
- Node.js + Express + Socket.IO for backend
- PostgreSQL for production, SQLite for local dev
- OpenAI API for AI judging (pluggable interface)
- Short-lived JWT (120s default) for QR scan session tokens

## Recent Milestone

- Production backend is now configured for `PERSISTENCE_MODE=postgres` and connected to Railway Postgres (`DATABASE_URL` sourced from Postgres service)
- Production DB migrations have been applied (`001_initial.sql`, `002_runtime_state.sql`) and seed data has been loaded from `seed-config.json`
- Runtime state reset script is now available (`npm run reset-state -w backend`) and was used to align runtime snapshot with seeded data
- Production backend redeploy is healthy after Postgres migration/seed (healthcheck path `/api/health`)
- Production smoke test (`npm run smoke:prod -w backend`) and synthetic checks (`npm run synthetic:prod -w backend`) both pass
- Backend integration test baseline added in `backend/tests/gameRoutes.test.ts`
- Current passing coverage includes role permissions, required clue pass restriction, QR future-scan rejection, review queue resolution, and sabotage cooldown
- Coverage now also includes admin deduction/audit-log verification and realtime event emission assertions for clue advance, verdict ready, leaderboard updates, and clue reopen
- Remaining planned route-level realtime emissions are now covered as well (`sabotage:triggered`, `game:status_changed`)
- Mobile app moved beyond Expo starter to API-backed MVP shell in `mobile/App.tsx`
- Mobile API logic is now split into service/hook modules and includes QR scan session + validation flow wiring
- Mobile sabotage store is now wired with captain trigger and member read-only behavior
- Team event feed endpoint and mobile feed UI/security-report action are now implemented
- Team submissions history endpoint and mobile verdict-history viewer are now implemented
- Admin live-ops UX now has dedicated controls for review resolution, security-event deductions, clue reopen, and leaderboard-driven prefill helpers
- Admin live-ops UX now includes game status transitions and review PASS point override input
- Admin setup UX now includes scan-session invalidation and clue QR public-id rotation controls (with backend persistence)
- OpenAPI contract is now updated to match implemented runtime/admin endpoints; admin live-ops now supports configurable auto-refresh polling
- OpenAPI now includes concrete response schemas for review queue/event feed/submission history, and admin UI has baseline realtime Socket.IO listeners
- Admin UI now includes a persistent realtime event log panel; OpenAPI now includes concrete request/response examples for key admin operations
- Admin UI now supports toggling realtime socket connection and filtering audit logs by action/team for faster triage
- Admin security/audit endpoints now support server-side `limit` query parameters and UI controls for bounded fetch size
- Admin review queue now also supports server-side `limit` with matching UI control for list-size parity
- Route-layer numeric `limit` parsing is now extracted into shared helper `backend/src/utils/parseLimit.ts`
- Team event-feed and submissions endpoints now support `limit` query parity, with OpenAPI docs and integration test coverage (`18/18` backend tests)
- Shared `parseLimit` helper now has direct backend tests for fallback, truncation, and clamping behavior; backend test suite is currently green at `21/21`
- List endpoints now support `offset` pagination alongside `limit` for team feed/submissions and admin review/security/audit routes; Admin Live Ops includes matching offset controls
- Shared `parseOffset` helper and integration assertions were added; backend suite is currently green at `24/24`
- List endpoints now return a standardized pagination envelope (`items`, `total`, `limit`, `offset`) across team/admin feed-style routes, with admin UI consuming totals and OpenAPI schemas aligned
- Mobile team event feed and submission history now support user-entered `limit/offset` controls and consume pagination totals from backend envelope responses
- Mobile feed/history now include hook-driven `Prev`/`Next` pagination actions with immediate page fetch and backend-total boundary guards
- Mobile feed/history now display compact page indicators and disable Prev/Next at boundaries for clearer paging affordance
- Mobile pagination empty-state copy now reads `No pages yet` instead of `Page 0 of 0` for clearer UX
- Mobile now includes a lightweight pagination utility + unit tests (`mobile/src/utils/pagination.ts`, `mobile/src/utils/pagination.test.ts`) with `npm run test -w mobile` passing (`6/6`)
- Admin now uses a shared pagination utility (`admin/src/utils/pagination.ts`) for list parsing/derivation and displays compact `Page N of M` metadata in Live Ops list sections
- Admin Live Ops now includes boundary-aware `Prev`/`Next` pagination controls for review queue, security events, and audit logs
- Admin now has a lightweight utility test harness with pagination unit coverage (`admin/src/utils/pagination.test.ts`, `npm run test -w admin` passing `6/6`)
- Admin Live Ops now also includes quick-jump `First`/`Last` controls for review queue, security events, and audit logs
- Admin Live Ops pagination controls now include compact helper text clarifying zero-based offset behavior and limit-sized page jumps
- Admin Live Ops leaderboard now includes a `Prepare Deduct` workflow shortcut alongside `Prepare Reopen` for faster team-targeted actions
- Admin Live Ops leaderboard now supports one-click `Load Team Context` prefill (deduct/reopen/review filter/audit filter), and review queue now has a team filter input for faster triage
- Admin Live Ops now includes a one-click `Clear Team Context` control to reset deduction/reopen/team-filter prefill fields between triage actions
- Admin Live Ops Security Events now include an optional scope toggle to inherit the current review-team filter for cross-list triage alignment
- Railway backend deployment pipeline is now aligned to monorepo root via `railway.json` + `backend/Dockerfile`; production service `scavenge-backend` is deployed successfully with live `/api/health` and `/api/game/status` both responding `200`
- Production smoke test now confirms admin login token issuance and authenticated leaderboard retrieval (`4` teams) against the Railway backend service
- Reusable one-command production smoke script is now available at `backend/scripts/smoke-prod.ps1` and wired to `npm run smoke:prod -w backend`
- Full web UI hosting is now live on Railway service `scavenge-web` (`https://scavenge-web-production.up.railway.app`) with successful status and production API wiring to the backend service
- Production first-user API flow is verified live (join → team state → leaderboard → scan session token) using current seeded join codes
- Production web interactivity issue is fixed (frontend no longer falls back to localhost API); live role-based e2e checks now pass for member, captain, and admin critical paths
- Browser-side production interactivity is now additionally fixed via backend CORS allowlist update for the web domain, and web defaults now align with current seeded join-code format
- Guided player progression flow is now implemented in web UI and deployed, with production rules updated to a 14-clue hunt and 9 completed clues required for eligibility
