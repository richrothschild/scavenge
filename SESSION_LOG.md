# SCAVENGE — Session Log

## Session 1 — 2026-02-25

**Work completed:**
- Created full project spec in CLAUDE.md from user requirements document
- Created PROJECT_STATE.md (build status tracker)
- Created backend/seed/seed-config.json with:
  - Game settings (Boyz Weekend 2026, April 11 2026 10AM PT)
  - 4 teams: Spades (Lars), Hearts (Carl), Diamonds (Rich), Clubs (Dave)
  - 12 clues: 2 test clues (Giants Proof, 49ers Proof) + 8 TBD placeholders + 2 required transport clues (Waymo to Lombard, Cable Car) + 2 required Buena Vista clues
  - 5 sabotage actions

**Pending from user:**
- The actual 12 clue texts, locations, required/optional designation
- Confirmation of which order_index triggers Waymo and cable car
- Custom sabotage actions / point tuning
- Final captain PINs (or confirm auto-generated defaults from seed)

**Next session should start with:**
- Phase 1: Scaffold monorepo, define OpenAPI contract, create DB migrations
