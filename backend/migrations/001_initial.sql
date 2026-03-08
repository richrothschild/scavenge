CREATE TABLE IF NOT EXISTS games (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  timezone TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'PAUSED', 'ENDED')),
  admin_password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (name IN ('SPADES', 'HEARTS', 'DIAMONDS', 'CLUBS')),
  join_code TEXT NOT NULL UNIQUE,
  captain_name TEXT NOT NULL,
  captain_pin_hash TEXT NOT NULL,
  score_total INTEGER NOT NULL DEFAULT 0,
  sabotage_balance INTEGER NOT NULL DEFAULT 0,
  current_clue_index INTEGER NOT NULL DEFAULT 0,
  completed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  eligibility_status TEXT NOT NULL DEFAULT 'INELIGIBLE' CHECK (eligibility_status IN ('ELIGIBLE', 'INELIGIBLE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS participants (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('CAPTAIN', 'MEMBER')),
  device_info JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clues (
  id UUID PRIMARY KEY,
  order_index INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL,
  instructions TEXT NOT NULL,
  required_flag BOOLEAN NOT NULL,
  transport_mode TEXT NOT NULL CHECK (transport_mode IN ('WALK', 'WAYMO', 'CABLE_CAR', 'NONE')),
  requires_scan BOOLEAN NOT NULL DEFAULT FALSE,
  submission_type TEXT NOT NULL CHECK (submission_type IN ('PHOTO', 'VIDEO', 'TEXT', 'NONE')),
  ai_rubric TEXT,
  base_points INTEGER NOT NULL,
  qr_public_id TEXT,
  lock_after_advance BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_clue_states (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  clue_id UUID NOT NULL REFERENCES clues(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('LOCKED', 'ACTIVE', 'COMPLETED', 'PASSED')),
  scan_validated BOOLEAN NOT NULL DEFAULT FALSE,
  submissions_count INTEGER NOT NULL DEFAULT 0,
  points_awarded INTEGER NOT NULL DEFAULT 0,
  opened_by_admin_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, clue_id)
);

CREATE TABLE IF NOT EXISTS submissions (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  clue_id UUID NOT NULL REFERENCES clues(id) ON DELETE CASCADE,
  participant_id UUID REFERENCES participants(id) ON DELETE SET NULL,
  media_url TEXT,
  text_content TEXT,
  ai_verdict TEXT CHECK (ai_verdict IN ('PASS', 'FAIL', 'NEEDS_REVIEW')),
  ai_score INTEGER,
  ai_reasons JSONB,
  ai_safety_flags JSONB,
  admin_override BOOLEAN NOT NULL DEFAULT FALSE,
  points_awarded INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS security_events (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  participant_id UUID REFERENCES participants(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  device_info JSONB,
  clue_id UUID REFERENCES clues(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('ADMIN', 'SYSTEM')),
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  reason TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sabotage_actions (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  cost INTEGER NOT NULL,
  cooldown_seconds INTEGER NOT NULL,
  effect_type TEXT NOT NULL,
  effect_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sabotage_purchases (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  action_id UUID NOT NULL REFERENCES sabotage_actions(id) ON DELETE CASCADE,
  triggered_by UUID REFERENCES participants(id) ON DELETE SET NULL,
  target_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  cost_deducted INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scan_session_tokens (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  clue_id UUID NOT NULL REFERENCES clues(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_clue_states_team ON team_clue_states(team_id);
CREATE INDEX IF NOT EXISTS idx_submissions_team_clue ON submissions(team_id, clue_id);
CREATE INDEX IF NOT EXISTS idx_security_events_team ON security_events(team_id);
CREATE INDEX IF NOT EXISTS idx_scan_tokens_team_clue ON scan_session_tokens(team_id, clue_id);
