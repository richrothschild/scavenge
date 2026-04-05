import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

const apiBase =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.PROD
    ? "https://scavenge-backend-production.up.railway.app/api"
    : "http://localhost:3001/api");

// Lock times (PDT = UTC-7)
const THU_LOCK = new Date("2026-04-10T01:30:00Z"); // Thu Apr 9  6:30 PM PDT
const FRI_LOCK = new Date("2026-04-10T19:00:00Z"); // Fri Apr 10 12:00 PM PDT
const SAT_LOCK = new Date("2026-04-11T15:00:00Z"); // Sat Apr 11 8:00 AM PDT

type TabId = "rules" | "spades" | "hearts" | "diamonds" | "clubs";
type TeamId = "spades" | "hearts" | "diamonds" | "clubs";

const TABS: { id: TabId; label: string; color: string }[] = [
  { id: "rules",    label: "Rules",       color: "#94a3b8" },
  { id: "spades",   label: "♠ Spades",   color: "#818cf8" },
  { id: "hearts",   label: "♥ Hearts",   color: "#f87171" },
  { id: "diamonds", label: "♦ Diamonds", color: "#fbbf24" },
  { id: "clubs",    label: "♣ Clubs",    color: "#4ade80" },
];

const TEAM_COLORS: Record<TeamId, string> = {
  spades: "#818cf8", hearts: "#f87171", diamonds: "#fbbf24", clubs: "#4ade80",
};

const GAMES = [
  { id: "thu_nba_1" as const, sport: "NBA", t1: "Lakers",    t2: "Warriors", lock: THU_LOCK, day: "thursday" as const },
  { id: "fri_nba_1" as const, sport: "NBA", t1: "Warriors",  t2: "Kings",    lock: FRI_LOCK, day: "friday"   as const },
  { id: "fri_nba_2" as const, sport: "NBA", t1: "Minnesota", t2: "Houston",  lock: FRI_LOCK, day: "friday"   as const },
  { id: "fri_mlb_1" as const, sport: "MLB", t1: "Hou",       t2: "Sea",      lock: FRI_LOCK, day: "friday"   as const },
  { id: "fri_mlb_2" as const, sport: "MLB", t1: "Min",       t2: "Tor",      lock: FRI_LOCK, day: "friday"   as const },
  { id: "sat_mlb_1" as const, sport: "MLB", t1: "Ath",       t2: "NYM",      lock: SAT_LOCK, day: "saturday" as const },
  { id: "sat_mlb_2" as const, sport: "MLB", t1: "SF",        t2: "Bal",      lock: SAT_LOCK, day: "saturday" as const },
] as const;

type TeamPicks = {
  thu_nba_1?: string;
  fri_nba_1?: string;
  fri_nba_2?: string;
  fri_mlb_1?: string;
  fri_mlb_2?: string;
  sat_mlb_1?: string;
  sat_mlb_2?: string;
  masters_1?: string;
  masters_2?: string;
  masters_3?: string;
  rory_score?: string;
  updatedAt?: string;
};

type BettingResults = {
  thu_nba_1?: string;
  fri_nba_1?: string;
  fri_nba_2?: string;
  fri_mlb_1?: string;
  fri_mlb_2?: string;
  sat_mlb_1?: string;
  sat_mlb_2?: string;
  masters_total_spades?: number;
  masters_total_hearts?: number;
  masters_total_diamonds?: number;
  masters_total_clubs?: number;
  rory_actual?: number;
};

type BettingData = {
  picks: Partial<Record<TeamId, TeamPicks>>;
  results: BettingResults;
  lockStatus: { thursday: boolean; friday: boolean; saturday: boolean };
};

const TEAMS: TeamId[] = ["spades", "hearts", "diamonds", "clubs"];
const RANK_PTS = [5, 3, 1, 0];

function calcMastersRanks(results: BettingResults): Partial<Record<TeamId, { rank: number; points: number; total: number }>> {
  const scores: { team: TeamId; total: number }[] = [];
  for (const t of TEAMS) {
    const key = `masters_total_${t}` as keyof BettingResults;
    const v = results[key];
    if (typeof v === "number") scores.push({ team: t, total: v });
  }
  if (scores.length === 0) return {};
  scores.sort((a, b) => a.total - b.total);
  const out: Partial<Record<TeamId, { rank: number; points: number; total: number }>> = {};
  scores.forEach(({ team, total }, i) => {
    out[team] = { rank: i + 1, points: RANK_PTS[i] ?? 0, total };
  });
  return out;
}

function calcTeamPoints(teamId: TeamId, picks: TeamPicks, results: BettingResults): number {
  let pts = 0;
  for (const g of GAMES) {
    const p = picks[g.id];
    const r = results[g.id];
    if (p && r && p === r) pts++;
  }
  const mastersRanks = calcMastersRanks(results);
  if (mastersRanks[teamId]) pts += mastersRanks[teamId]!.points;
  return pts;
}

function LockBadge({ locked, lockTime }: { locked: boolean; lockTime: Date }) {
  if (locked) return <span className="sb-lock-badge sb-locked">🔒 Locked</span>;
  const h = lockTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
  const d = lockTime.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Los_Angeles" });
  return <span className="sb-lock-badge sb-open">⏰ Locks {d} at {h} PT</span>;
}

interface GameRowProps {
  game: typeof GAMES[number];
  pick: string | undefined;
  result: string | undefined;
  locked: boolean;
  onChange: (val: string) => void;
}

function GameRow({ game, pick, result, locked, onChange }: GameRowProps) {
  const hasResult = !!result;
  const correct = hasResult && pick === result;
  const wrong = hasResult && pick && pick !== result;

  return (
    <div className={`sb-game-row${locked ? " locked" : ""}`}>
      <span className="sb-game-sport">{game.sport}</span>
      <div className="sb-game-picks">
        {([game.t1, game.t2] as [string, string]).map((team) => {
          const isResult = hasResult && result === team;
          const isPick = pick === team;
          return (
            <label
              key={team}
              className={`sb-pick-label${isPick ? " selected" : ""}${isResult ? " is-result" : ""}${isPick && correct ? " correct" : ""}${isPick && wrong ? " wrong" : ""}`}
            >
              <input
                type="radio"
                name={`${game.id}`}
                value={team}
                checked={isPick}
                disabled={locked}
                onChange={() => onChange(team)}
              />
              {team}
              {isPick && correct && <span className="sb-verdict">✓</span>}
              {isPick && wrong  && <span className="sb-verdict sb-wrong">✗</span>}
              {isResult && !isPick && <span className="sb-result-marker">← result</span>}
            </label>
          );
        })}
      </div>
    </div>
  );
}

interface TeamTabProps {
  teamId: TeamId;
  picks: TeamPicks;
  data: BettingData;
  now: Date;
  onPickChange: (field: keyof TeamPicks, val: string) => void;
  onSave: () => void;
  saving: boolean;
  saveMsg: string;
}

function TeamTab({ teamId, picks, data, now, onPickChange, onSave, saving, saveMsg }: TeamTabProps) {
  const results = data.results;
  const thuLocked = now >= THU_LOCK;
  const friLocked = now >= FRI_LOCK;
  const satLocked = now >= SAT_LOCK;
  const color = TEAM_COLORS[teamId];

  const mastersRanks = calcMastersRanks(results);
  const mastersResult = mastersRanks[teamId];
  const gamePoints = GAMES.reduce((acc, g) => acc + (picks[g.id] && results[g.id] && picks[g.id] === results[g.id] ? 1 : 0), 0);
  const totalPoints = calcTeamPoints(teamId, picks, results);

  const hasAnyResult = GAMES.some(g => !!results[g.id]) || mastersResult !== undefined || results.rory_actual !== undefined;

  const roryGuess = picks.rory_score ? Number(picks.rory_score) : null;
  const roryActual = results.rory_actual ?? null;
  const roryDiff = roryGuess !== null && roryActual !== null ? Math.abs(roryGuess - roryActual) : null;

  const allLocked = thuLocked && friLocked && satLocked;
  const hasPicks = GAMES.some(g => !!picks[g.id]) || picks.masters_1 || picks.masters_2 || picks.masters_3 || picks.rory_score;

  return (
    <div className="gn-card" style={{ borderLeftColor: color }}>
      <p className="gn-card-title" style={{ color }}>
        {teamId === "spades" ? "♠" : teamId === "hearts" ? "♥" : teamId === "diamonds" ? "♦" : "♣"} {teamId.charAt(0).toUpperCase() + teamId.slice(1)} — Picks
      </p>

      {/* Thursday */}
      <div className="sb-day-section">
        <div className="sb-day-header">
          <span className="sb-day-label">Thursday, Apr 9</span>
          <LockBadge locked={thuLocked} lockTime={THU_LOCK} />
        </div>
        {GAMES.filter(g => g.day === "thursday").map(g => (
          <GameRow
            key={g.id}
            game={g}
            pick={picks[g.id]}
            result={results[g.id]}
            locked={thuLocked}
            onChange={(val) => onPickChange(g.id, val)}
          />
        ))}
      </div>

      {/* Friday games */}
      <div className="sb-day-section">
        <div className="sb-day-header">
          <span className="sb-day-label">Friday, Apr 10</span>
          <LockBadge locked={friLocked} lockTime={FRI_LOCK} />
        </div>
        {GAMES.filter(g => g.day === "friday").map(g => (
          <GameRow
            key={g.id}
            game={g}
            pick={picks[g.id]}
            result={results[g.id]}
            locked={friLocked}
            onChange={(val) => onPickChange(g.id, val)}
          />
        ))}
      </div>

      {/* Masters */}
      <div className="sb-day-section">
        <div className="sb-day-header">
          <span className="sb-day-label">Masters — Saturday Round</span>
          <LockBadge locked={friLocked} lockTime={FRI_LOCK} />
        </div>
        <p className="sb-masters-hint">Pick 3 golfers. Their combined Saturday score determines Masters points.</p>
        {(["masters_1", "masters_2", "masters_3"] as const).map((field, i) => (
          <div key={field} className="sb-masters-row">
            <span className="sb-masters-label">Golfer {i + 1}</span>
            <input
              className="sb-text-input"
              type="text"
              placeholder="Golfer name"
              value={picks[field] ?? ""}
              disabled={friLocked}
              onChange={(e) => onPickChange(field, e.target.value)}
            />
          </div>
        ))}
        <div className="sb-masters-row sb-tiebreaker-row">
          <span className="sb-masters-label">Tiebreaker — Rory's Sat score</span>
          <input
            className="sb-text-input sb-number-input"
            type="number"
            placeholder="e.g. 68"
            value={picks.rory_score ?? ""}
            disabled={friLocked}
            onChange={(e) => onPickChange("rory_score", e.target.value)}
          />
          {roryActual !== null && (
            <span className="sb-rory-actual">
              Actual: <strong>{roryActual}</strong>
              {roryDiff !== null && <span style={{ color: roryDiff === 0 ? "#4ade80" : "#94a3b8" }}> (diff: {roryDiff})</span>}
            </span>
          )}
        </div>
      </div>

      {/* Saturday */}
      <div className="sb-day-section">
        <div className="sb-day-header">
          <span className="sb-day-label">Saturday, Apr 11</span>
          <LockBadge locked={satLocked} lockTime={SAT_LOCK} />
        </div>
        {GAMES.filter(g => g.day === "saturday").map(g => (
          <GameRow
            key={g.id}
            game={g}
            pick={picks[g.id]}
            result={results[g.id]}
            locked={satLocked}
            onChange={(val) => onPickChange(g.id, val)}
          />
        ))}
      </div>

      {/* Save */}
      {!allLocked && (
        <button className="sb-save-btn" onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : "Save Picks"}
        </button>
      )}
      {saveMsg && <p className={`sb-save-msg${saveMsg.startsWith("Picks saved") ? " success" : " error"}`}>{saveMsg}</p>}
      {allLocked && !hasPicks && (
        <p className="sb-save-msg error">No picks were saved for this team.</p>
      )}

      {/* Points summary */}
      {hasAnyResult && (
        <div className="sb-points-summary">
          <p className="gn-section-heading">Points Earned</p>
          <div className="sb-points-row">
            <span>Game picks ({gamePoints} correct)</span>
            <span className="sb-pts-val">+{gamePoints}</span>
          </div>
          {mastersResult !== undefined ? (
            <div className="sb-points-row">
              <span>Masters (rank #{mastersResult.rank}, combined {mastersResult.total})</span>
              <span className="sb-pts-val">+{mastersResult.points}</span>
            </div>
          ) : (
            <div className="sb-points-row">
              <span>Masters (pending)</span>
              <span className="sb-pts-val">—</span>
            </div>
          )}
          <div className="sb-points-total">
            <span>Total</span>
            <span>{totalPoints} pts</span>
          </div>
        </div>
      )}
    </div>
  );
}

interface AdminResultsPanelProps {
  results: BettingResults;
  onSave: (r: BettingResults) => Promise<void>;
  saving: boolean;
  msg: string;
}

function AdminResultsPanel({ results, onSave, saving, msg }: AdminResultsPanelProps) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [form, setForm] = useState<BettingResults>({ ...results });

  // Sync form when results change externally
  useEffect(() => { setForm(prev => ({ ...results, ...prev })); }, [results]);

  const setField = (key: keyof BettingResults, val: string) => {
    const isNum = key.startsWith("masters_") || key === "rory_actual";
    setForm(prev => ({ ...prev, [key]: isNum ? (val === "" ? undefined : Number(val)) : (val || undefined) }));
  };

  const gameFields: { id: keyof BettingResults; t1: string; t2: string; label: string }[] = [
    { id: "thu_nba_1", t1: "Lakers",    t2: "Warriors", label: "Thu NBA: Lakers vs Warriors" },
    { id: "fri_nba_1", t1: "Warriors",  t2: "Kings",    label: "Fri NBA: Warriors vs Kings" },
    { id: "fri_nba_2", t1: "Minnesota", t2: "Houston",  label: "Fri NBA: Minnesota vs Houston" },
    { id: "fri_mlb_1", t1: "Hou",       t2: "Sea",      label: "Fri MLB: Hou vs Sea" },
    { id: "fri_mlb_2", t1: "Min",       t2: "Tor",      label: "Fri MLB: Min vs Tor" },
    { id: "sat_mlb_1", t1: "Ath",       t2: "NYM",      label: "Sat MLB: Ath vs NYM" },
    { id: "sat_mlb_2", t1: "SF",        t2: "Bal",      label: "Sat MLB: SF vs Bal" },
  ];

  return (
    <div className="sb-admin-panel">
      <button className="sb-admin-toggle" onClick={() => setOpen(o => !o)}>
        🔧 Admin: Enter Results {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="sb-admin-form">
          <div className="sb-admin-token-row">
            <label>Admin Token</label>
            <input
              type="password"
              className="sb-text-input"
              placeholder="Enter admin token"
              value={token}
              onChange={e => setToken(e.target.value)}
            />
          </div>

          <p className="gn-section-heading" style={{ marginTop: "0.75rem" }}>Game Results</p>
          {gameFields.map(({ id, t1, t2, label }) => (
            <div key={id as string} className="sb-admin-result-row">
              <span className="sb-admin-result-label">{label}</span>
              <div className="sb-game-picks">
                {([t1, t2] as [string, string]).map(team => (
                  <label key={team} className={`sb-pick-label${form[id] === team ? " selected" : ""}`}>
                    <input
                      type="radio"
                      name={`admin_${id as string}`}
                      value={team}
                      checked={form[id] === team}
                      onChange={() => setField(id, team)}
                    />
                    {team}
                  </label>
                ))}
                <button
                  className="sb-clear-btn"
                  onClick={() => setField(id, "")}
                  title="Clear"
                >✕</button>
              </div>
            </div>
          ))}

          <p className="gn-section-heading" style={{ marginTop: "0.75rem" }}>Masters — Combined Saturday Score per Team</p>
          <p className="sb-masters-hint">Enter the sum of each team's 3 golfers' Saturday scores. Lower = better.</p>
          {(["spades", "hearts", "diamonds", "clubs"] as TeamId[]).map(t => {
            const key = `masters_total_${t}` as keyof BettingResults;
            return (
              <div key={t} className="sb-masters-row">
                <span className="sb-masters-label" style={{ color: TEAM_COLORS[t] }}>
                  {t === "spades" ? "♠" : t === "hearts" ? "♥" : t === "diamonds" ? "♦" : "♣"} {t.charAt(0).toUpperCase() + t.slice(1)}
                </span>
                <input
                  className="sb-text-input sb-number-input"
                  type="number"
                  placeholder="Combined score"
                  value={form[key] !== undefined ? String(form[key]) : ""}
                  onChange={e => setField(key, e.target.value)}
                />
              </div>
            );
          })}

          <p className="gn-section-heading" style={{ marginTop: "0.75rem" }}>Tiebreaker — Rory's Actual Saturday Score</p>
          <div className="sb-masters-row">
            <span className="sb-masters-label">Rory's score</span>
            <input
              className="sb-text-input sb-number-input"
              type="number"
              placeholder="e.g. 68"
              value={form.rory_actual !== undefined ? String(form.rory_actual) : ""}
              onChange={e => setField("rory_actual", e.target.value)}
            />
          </div>

          <button
            className="sb-save-btn"
            style={{ marginTop: "1rem" }}
            disabled={saving || !token}
            onClick={() => onSave({ ...form, _token: token } as BettingResults & { _token: string })}
          >
            {saving ? "Saving…" : "Save Results"}
          </button>
          {msg && <p className={`sb-save-msg${msg.startsWith("Results saved") ? " success" : " error"}`}>{msg}</p>}
        </div>
      )}
    </div>
  );
}

function RulesTab({ data, onAdminSave, adminSaving, adminMsg }: {
  data: BettingData;
  onAdminSave: (r: BettingResults) => Promise<void>;
  adminSaving: boolean;
  adminMsg: string;
}) {
  const mastersRanks = calcMastersRanks(data.results);

  return (
    <>
      {/* Scoring */}
      <div className="gn-card" style={{ borderLeftColor: "#94a3b8" }}>
        <p className="gn-card-title">Scoring</p>
        <p className="gn-section-heading">NBA &amp; MLB Picks — 1 point each</p>
        <ul className="gn-rule-list">
          <li>Pick the winner of each game. No point spreads or odds — just pick the winner.</li>
          <li>1 point for each correct pick.</li>
          <li>7 games total = maximum 7 points from game picks.</li>
        </ul>
        <p className="gn-section-heading">Masters Golf — Combined Saturday Score</p>
        <ul className="gn-rule-list">
          <li>Each team picks 3 golfers competing in the Masters on Saturday, Apr 12.</li>
          <li>The 3 golfers' Saturday round scores are added together (lower = better).</li>
          <li><strong style={{ color: "#4ade80" }}>1st place (lowest combined): +5 points</strong></li>
          <li><strong style={{ color: "#fbbf24" }}>2nd place: +3 points</strong></li>
          <li><strong>3rd place: +1 point</strong></li>
          <li>4th place: 0 points</li>
        </ul>
        <p className="gn-section-heading">Tiebreaker</p>
        <ul className="gn-rule-list">
          <li>Each team guesses Rory McIlroy's total score for Saturday's round.</li>
          <li>Closest guess (without going over, or absolute closest) breaks any tie.</li>
        </ul>
      </div>

      {/* Schedule */}
      <div className="gn-card" style={{ borderLeftColor: "#94a3b8" }}>
        <p className="gn-card-title">Pick Schedule</p>

        <p className="gn-section-heading">Thursday, Apr 9 — Locks 6:30 PM PT</p>
        <div className="sb-schedule-group">
          <div className="sb-schedule-row"><span className="sb-sched-sport">NBA</span><span>Lakers vs Warriors</span></div>
        </div>

        <p className="gn-section-heading">Friday, Apr 10 — Locks 12:00 PM PT</p>
        <div className="sb-schedule-group">
          <div className="sb-schedule-row"><span className="sb-sched-sport">NBA</span><span>Warriors vs Kings</span></div>
          <div className="sb-schedule-row"><span className="sb-sched-sport">NBA</span><span>Minnesota vs Houston</span></div>
          <div className="sb-schedule-row"><span className="sb-sched-sport">MLB</span><span>Houston vs Seattle</span></div>
          <div className="sb-schedule-row"><span className="sb-sched-sport">MLB</span><span>Minnesota vs Toronto</span></div>
          <div className="sb-schedule-row"><span className="sb-sched-sport">⛳</span><span>Masters — pick 3 golfers + Rory tiebreaker</span></div>
        </div>

        <p className="gn-section-heading">Saturday, Apr 11 — Locks 8:00 AM PT</p>
        <div className="sb-schedule-group">
          <div className="sb-schedule-row"><span className="sb-sched-sport">MLB</span><span>Athletics vs NY Mets</span></div>
          <div className="sb-schedule-row"><span className="sb-sched-sport">MLB</span><span>SF Giants vs Baltimore</span></div>
        </div>
      </div>

      {/* Live standings if results available */}
      {Object.keys(data.results).length > 0 && (
        <div className="gn-card" style={{ borderLeftColor: "#22d3ee" }}>
          <p className="gn-card-title">Current Standings</p>
          {(["spades", "hearts", "diamonds", "clubs"] as TeamId[])
            .map(t => ({
              teamId: t,
              total: calcTeamPoints(t, data.picks[t] ?? {}, data.results),
            }))
            .sort((a, b) => b.total - a.total)
            .map(({ teamId, total }, i) => {
              const mastersResult = mastersRanks[teamId];
              return (
                <div key={teamId} className="sb-standings-row">
                  <span className="sb-standings-rank">#{i + 1}</span>
                  <span style={{ color: TEAM_COLORS[teamId], fontWeight: 700 }}>
                    {teamId === "spades" ? "♠" : teamId === "hearts" ? "♥" : teamId === "diamonds" ? "♦" : "♣"} {teamId.charAt(0).toUpperCase() + teamId.slice(1)}
                  </span>
                  {mastersResult && (
                    <span className="sb-standings-detail">Masters #{mastersResult.rank} (+{mastersResult.points})</span>
                  )}
                  <span className="sb-standings-pts">{total} pts</span>
                </div>
              );
            })
          }
        </div>
      )}

      {/* Admin panel */}
      <AdminResultsPanel
        results={data.results}
        onSave={onAdminSave}
        saving={adminSaving}
        msg={adminMsg}
      />
    </>
  );
}

export default function SportsBettingPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>("rules");
  const [data, setData] = useState<BettingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(new Date());
  const initialized = useRef(false);

  const [formPicks, setFormPicks] = useState<Record<TeamId, TeamPicks>>({
    spades: {}, hearts: {}, diamonds: {}, clubs: {},
  });
  const [saving, setSaving] = useState<TeamId | null>(null);
  const [saveMsg, setSaveMsg] = useState<Record<TeamId, string>>({
    spades: "", hearts: "", diamonds: "", clubs: "",
  });
  const [adminSaving, setAdminSaving] = useState(false);
  const [adminMsg, setAdminMsg] = useState("");

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/sportsbetting`);
      if (!r.ok) throw new Error();
      const d: BettingData = await r.json();
      setData(d);
      if (!initialized.current) {
        setFormPicks({
          spades:   d.picks.spades   ?? {},
          hearts:   d.picks.hearts   ?? {},
          diamonds: d.picks.diamonds ?? {},
          clubs:    d.picks.clubs    ?? {},
        });
        initialized.current = true;
      }
    } catch {
      setError("Could not load sports betting data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handlePickChange = (teamId: TeamId, field: keyof TeamPicks, val: string) => {
    setFormPicks(prev => ({
      ...prev,
      [teamId]: { ...prev[teamId], [field]: val },
    }));
  };

  const handleSave = async (teamId: TeamId) => {
    setSaving(teamId);
    setSaveMsg(prev => ({ ...prev, [teamId]: "" }));
    try {
      const r = await fetch(`${apiBase}/sportsbetting/picks/${teamId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formPicks[teamId]),
      });
      const result = await r.json();
      if (r.ok) {
        setFormPicks(prev => ({ ...prev, [teamId]: result.picks }));
        const rej = result.rejected?.length ?? 0;
        setSaveMsg(prev => ({
          ...prev,
          [teamId]: rej > 0
            ? `Picks saved! (${rej} pick(s) were already locked)`
            : "Picks saved!",
        }));
        await fetchData();
      } else {
        setSaveMsg(prev => ({ ...prev, [teamId]: result.error ?? "Save failed." }));
      }
    } catch {
      setSaveMsg(prev => ({ ...prev, [teamId]: "Network error. Try again." }));
    } finally {
      setSaving(null);
    }
  };

  const handleAdminSave = async (results: BettingResults & { _token?: string }) => {
    setAdminSaving(true);
    setAdminMsg("");
    const { _token, ...body } = results as Record<string, unknown>;
    try {
      const r = await fetch(`${apiBase}/admin/sportsbetting/results`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-admin-token": String(_token ?? "") },
        body: JSON.stringify(body),
      });
      const result = await r.json();
      if (r.ok) {
        setAdminMsg("Results saved!");
        await fetchData();
      } else {
        setAdminMsg(result.error ?? "Save failed. Check your admin token.");
      }
    } catch {
      setAdminMsg("Network error. Try again.");
    } finally {
      setAdminSaving(false);
    }
  };

  return (
    <div className="pub-page">
      <header className="pub-header">
        <button className="pub-back" onClick={() => navigate("/")}>← Home</button>
        <h1>Sports Betting</h1>
        <span className="pub-header-sub">Boyz Weekend 2026 · San Francisco</span>
      </header>

      <div className="pubcrawl-tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`pubcrawl-tab${activeTab === tab.id ? " active" : ""}`}
            style={activeTab === tab.id ? { color: tab.color, borderColor: tab.color } : {}}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="pubcrawl-content">
        {loading && <p className="pub-loading">Loading…</p>}
        {error && <p className="pub-error">{error}</p>}

        {data && (
          <>
            {activeTab === "rules" && (
              <RulesTab
                data={data}
                onAdminSave={handleAdminSave}
                adminSaving={adminSaving}
                adminMsg={adminMsg}
              />
            )}
            {(["spades", "hearts", "diamonds", "clubs"] as TeamId[]).map(t => (
              activeTab === t && (
                <TeamTab
                  key={t}
                  teamId={t}
                  picks={formPicks[t]}
                  data={data}
                  now={now}
                  onPickChange={(field, val) => handlePickChange(t, field, val)}
                  onSave={() => handleSave(t)}
                  saving={saving === t}
                  saveMsg={saveMsg[t]}
                />
              )
            ))}
          </>
        )}
      </div>
    </div>
  );
}
