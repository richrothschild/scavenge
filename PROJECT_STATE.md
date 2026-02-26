# SCAVENGE — Project State

Last updated: 2026-02-25

## Current Status: 🟡 SPEC PHASE — Not yet implemented

## Phase Progress

| Phase | Status | Notes |
|---|---|---|
| 0 – Spec + Seed Config | 🟡 IN PROGRESS | CLAUDE.md complete; seed JSON pending |
| 1 – Architecture + Repo | ⬜ NOT STARTED | |
| 2 – Backend MVP | ⬜ NOT STARTED | |
| 3 – Mobile MVP | ⬜ NOT STARTED | |
| 4 – Admin Console | ⬜ NOT STARTED | |
| 5 – Testing | ⬜ NOT STARTED | |
| 6 – Deployment | ⬜ NOT STARTED | |

## Blocking Items

- [ ] User must provide 12 actual clues (titles, text, locations, required/optional)
- [ ] User must confirm which clue index triggers Waymo step
- [ ] User must confirm which clue index triggers cable car step
- [ ] User must confirm sabotage catalog or approve generated defaults

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
