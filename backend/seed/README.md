# Backend Seed Notes

Current canonical seed source is the workspace root file:

- `seed-config.json`

Optional variant files for admin clue source switching:

- `seed-config.production.json` (or `seed-config.prod.json`)
- `seed-config.test.json` (or `seed-config.testing.json`)

Seed command:

- `npm run seed -w backend`

Requirements:

- Run migrations first (including `002_runtime_state.sql`)
- Set `PERSISTENCE_MODE=postgres`
- Set `DATABASE_URL` to your PostgreSQL instance

The seed script loads game, teams, clues, team clue states, and sabotage actions from `seed-config.json`.
