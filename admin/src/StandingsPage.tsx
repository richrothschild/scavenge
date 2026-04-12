import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const apiBase =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.PROD
    ? "https://scavenge-backend-production.up.railway.app/api"
    : "http://localhost:3001/api");

type LeaderboardTeam = {
  teamId: string;
  teamName: string;
  scoreTotal: number;
  currentClueIndex: number;
};

type JoinTeamOption = {
  teamId: string;
  teamName: string;
  captainName: string;
  assignedParticipants: string[];
};

type EventResult = { teamId: string; place: 1 | 2 | 3; pointsAwarded: number };
type EventItem = {
  id: string;
  title: string;
  date: string;
  firstPlaceBonus: number;
  secondPlaceBonus: number;
  thirdPlaceBonus: number;
  results: EventResult[];
};

const SUIT_ICONS: Record<string, string> = {
  SPADES: "♠", HEARTS: "♥", DIAMONDS: "♦", CLUBS: "♣",
};
const SUIT_COLORS: Record<string, string> = {
  SPADES: "#818cf8", HEARTS: "#f87171", DIAMONDS: "#fbbf24", CLUBS: "#4ade80",
};
const TEAMS = ["SPADES", "HEARTS", "DIAMONDS", "CLUBS"];

const PLACE_ICON: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export default function StandingsPage() {
  const navigate = useNavigate();
  const [leaderboard, setLeaderboard] = useState<LeaderboardTeam[]>([]);
  const [teams, setTeams] = useState<JoinTeamOption[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [tab, setTab] = useState<"overall" | "events" | "hunt" | "roster">("overall");

  // Admin assignment
  const [adminPw, setAdminPw] = useState("");
  const [adminToken, setAdminToken] = useState(() => sessionStorage.getItem("standings_admin_token") ?? "");
  const [adminLoginError, setAdminLoginError] = useState("");
  const [assignTeamId, setAssignTeamId] = useState("spades");
  const [assignName, setAssignName] = useState("");
  const [assignMsg, setAssignMsg] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);

  const loadData = async () => {
    try {
      const [lbRes, teamsRes, eventsRes] = await Promise.all([
        fetch(`${apiBase}/leaderboard`),
        fetch(`${apiBase}/join/options`),
        fetch(`${apiBase}/events`),
      ]);
      if (lbRes.ok) { const d = await lbRes.json(); setLeaderboard(d.leaderboard ?? []); }
      if (teamsRes.ok) { const d = await teamsRes.json(); setTeams(d.teams ?? []); }
      if (eventsRes.ok) {
        const d = await eventsRes.json();
        setEvents((d.events ?? []).filter((e: EventItem) => e.firstPlaceBonus > 0 || e.secondPlaceBonus > 0 || e.thirdPlaceBonus > 0));
      }
      setLastRefresh(new Date());
    } catch {
      setError("Could not load standings. Check connection.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, []);

  const adminLogin = async () => {
    setAdminLoginError("");
    try {
      const res = await fetch(`${apiBase}/auth/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: adminPw }),
      });
      const data = await res.json();
      if (res.ok && data.token) {
        setAdminToken(data.token);
        sessionStorage.setItem("standings_admin_token", data.token);
        setAdminPw("");
      } else { setAdminLoginError(data.error ?? "Login failed"); }
    } catch { setAdminLoginError("Network error"); }
  };

  const assignParticipant = async () => {
    if (!assignName.trim()) return;
    setAssignBusy(true);
    setAssignMsg("");
    try {
      const res = await fetch(`${apiBase}/admin/assign-participant`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": adminToken },
        body: JSON.stringify({ teamId: assignTeamId, participantName: assignName.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setAssignMsg(`✓ ${assignName.trim()} added to ${assignTeamId.toUpperCase()}`);
        setAssignName("");
        loadData();
      } else { setAssignMsg(`Error: ${data.error ?? "Unknown error"}`); }
    } catch { setAssignMsg("Network error"); }
    finally { setAssignBusy(false); }
  };

  const suitKey = (teamId: string) => teamId.toUpperCase().split("-")[0] ?? teamId.toUpperCase();

  // Per-team event points from event results
  const eventPointsByTeam = TEAMS.reduce<Record<string, number>>((acc, t) => { acc[t.toLowerCase()] = 0; return acc; }, {});
  for (const ev of events) {
    for (const r of ev.results) {
      eventPointsByTeam[r.teamId] = (eventPointsByTeam[r.teamId] ?? 0) + r.pointsAwarded;
    }
  }

  // Overall leaderboard = hunt points (scoreTotal) already includes event points awarded via gameEngine
  const enriched = leaderboard
    .map(lb => {
      const teamInfo = teams.find(t => t.teamId.toLowerCase() === lb.teamId.toLowerCase());
      const suit = suitKey(lb.teamId);
      return {
        ...lb,
        suit,
        color: SUIT_COLORS[suit] ?? "#94a3b8",
        icon: SUIT_ICONS[suit] ?? "★",
        captain: teamInfo?.captainName ?? "—",
        members: teamInfo?.assignedParticipants ?? [],
      };
    })
    .sort((a, b) => b.scoreTotal - a.scoreTotal);

  // Event-by-event breakdown per team
  const teamEventBreakdown = (teamId: string) =>
    events.map(ev => {
      const r = ev.results.find(r => r.teamId.toLowerCase() === teamId.toLowerCase());
      return { ...ev, place: r?.place ?? null, pts: r?.pointsAwarded ?? 0 };
    });

  return (
    <div className="pub-page">
      <header className="pub-header">
        <button className="pub-back" onClick={() => navigate("/")}>← Home</button>
        <h1>Teams &amp; Leaderboard</h1>
        {lastRefresh && (
          <span className="pub-refresh-hint">
            {lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        )}
      </header>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "0.4rem", padding: "0.75rem 1.25rem 0", flexWrap: "wrap" }}>
        {(["overall", "events", "hunt", "roster"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "0.35rem 0.9rem", borderRadius: "6px", border: "1px solid #334155",
            background: tab === t ? "#3b82f6" : "#1e293b",
            color: tab === t ? "#fff" : "#94a3b8",
            cursor: "pointer", fontWeight: tab === t ? 700 : 400, fontSize: "0.82rem",
            textTransform: "capitalize",
          }}>
            {t === "overall" ? "Overall" : t === "events" ? "By Event" : t === "hunt" ? "Scavenger Hunt" : "Rosters"}
          </button>
        ))}
      </div>

      {loading && <p className="pub-loading">Loading standings…</p>}
      {error && <p className="pub-error">{error}</p>}

      <div style={{ padding: "0.75rem 1.25rem" }}>

        {/* ── OVERALL ── */}
        {tab === "overall" && (
          <>
            {enriched.length === 0 && !loading && (
              <p style={{ color: "#475569", textAlign: "center", marginTop: "2rem" }}>No scores yet.</p>
            )}
            {enriched.map((team, idx) => (
              <div key={team.teamId} className="standings-card" style={{ borderLeftColor: team.color, marginBottom: "0.75rem" }}>
                <div className="standings-rank" style={{ color: team.color }}>#{idx + 1}</div>
                <div className="standings-suit" style={{ color: team.color }}>{team.icon}</div>
                <div className="standings-body">
                  <div className="standings-name">{team.teamName}</div>
                  <div className="standings-score" style={{ color: team.color }}>{team.scoreTotal.toLocaleString()} pts</div>
                  <div className="standings-clue" style={{ fontSize: "0.78rem", color: "#64748b" }}>Scavenger Hunt: Clue {team.currentClueIndex + 1}</div>
                  {/* Per-event chips */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.4rem" }}>
                    {teamEventBreakdown(team.teamId).filter(e => e.place !== null).map(e => (
                      <span key={e.id} style={{ fontSize: "0.72rem", background: "#0f172a", border: "1px solid #334155", borderRadius: "4px", padding: "0.15rem 0.4rem", color: "#94a3b8" }}>
                        {PLACE_ICON[e.place!]} {e.title} +{e.pts}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        {/* ── BY EVENT ── */}
        {tab === "events" && (
          <>
            {events.length === 0 && <p style={{ color: "#475569", textAlign: "center", marginTop: "2rem" }}>No event results recorded yet.</p>}
            {events.map(ev => {
              const sorted = [...ev.results].sort((a, b) => a.place - b.place);
              return (
                <div key={ev.id} className="gn-card" style={{ borderLeftColor: "#334155", marginBottom: "0.75rem" }}>
                  <p className="gn-card-title" style={{ fontSize: "0.9rem" }}>{ev.title} <span style={{ color: "#64748b", fontWeight: 400, fontSize: "0.75rem" }}>{ev.date}</span></p>
                  {sorted.length === 0 ? (
                    <p style={{ color: "#475569", fontSize: "0.8rem", margin: 0 }}>No results recorded</p>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                      {sorted.map(r => {
                        const suit = suitKey(r.teamId);
                        const color = SUIT_COLORS[suit] ?? "#94a3b8";
                        return (
                          <span key={r.teamId} style={{ fontSize: "0.82rem", background: "#0f172a", border: `1px solid ${color}`, borderRadius: "6px", padding: "0.25rem 0.6rem", color }}>
                            {PLACE_ICON[r.place]} {SUIT_ICONS[suit]} {r.teamId.toUpperCase()} +{r.pointsAwarded}pts
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        {/* ── HUNT ── */}
        {tab === "hunt" && (
          <>
            {enriched.length === 0 && !loading && (
              <p style={{ color: "#475569", textAlign: "center", marginTop: "2rem" }}>Hunt hasn't started yet.</p>
            )}
            <div className="standings-grid">
              {enriched.map((team, idx) => (
                <div key={team.teamId} className="standings-card" style={{ borderLeftColor: team.color }}>
                  <div className="standings-rank" style={{ color: team.color }}>#{idx + 1}</div>
                  <div className="standings-suit" style={{ color: team.color }}>{team.icon}</div>
                  <div className="standings-body">
                    <div className="standings-name">{team.teamName}</div>
                    <div className="standings-score" style={{ color: team.color }}>{team.scoreTotal.toLocaleString()} pts</div>
                    <div className="standings-clue">Clue {team.currentClueIndex + 1}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── ROSTERS ── */}
        {tab === "roster" && (
          <>
            {teams.map(t => {
              const suit = suitKey(t.teamId);
              const color = SUIT_COLORS[suit] ?? "#94a3b8";
              return (
                <div key={t.teamId} className="pub-roster-row" style={{ borderLeftColor: color, marginBottom: "0.75rem" }}>
                  <strong style={{ color }}>{SUIT_ICONS[suit] ?? "★"} {t.teamName}</strong>
                  <span style={{ color: "#64748b", fontSize: "0.82rem" }}> · Captain: {t.captainName || "—"}</span>
                  <div className="pub-roster-members">
                    {t.assignedParticipants.length === 0
                      ? <em style={{ color: "#475569" }}>No members assigned yet</em>
                      : t.assignedParticipants.map(m => <span key={m} className="standings-member">{m}</span>)}
                  </div>
                </div>
              );
            })}

            <section className="pub-admin-section" style={{ marginTop: "1.5rem" }}>
              <h2>Team Assignment <span className="pub-admin-badge">Admin</span></h2>
              {!adminToken ? (
                <div className="pub-admin-login">
                  <input type="password" placeholder="Admin password" value={adminPw}
                    onChange={e => setAdminPw(e.target.value)} onKeyDown={e => e.key === "Enter" && adminLogin()} />
                  <button onClick={adminLogin}>Unlock</button>
                  {adminLoginError && <p className="pub-error">{adminLoginError}</p>}
                </div>
              ) : (
                <div className="pub-admin-assign">
                  <p className="pub-admin-active">Admin unlocked · <button className="pub-link-btn" onClick={() => { setAdminToken(""); sessionStorage.removeItem("standings_admin_token"); }}>Lock</button></p>
                  <div className="pub-admin-form">
                    <select value={assignTeamId} onChange={e => setAssignTeamId(e.target.value)}>
                      <option value="spades">♠ Spades</option>
                      <option value="hearts">♥ Hearts</option>
                      <option value="diamonds">♦ Diamonds</option>
                      <option value="clubs">♣ Clubs</option>
                    </select>
                    <input placeholder="Participant name" value={assignName}
                      onChange={e => setAssignName(e.target.value)} onKeyDown={e => e.key === "Enter" && assignParticipant()} />
                    <button onClick={assignParticipant} disabled={assignBusy || !assignName.trim()}>
                      {assignBusy ? "Adding…" : "Add to Team"}
                    </button>
                  </div>
                  {assignMsg && <p className={assignMsg.startsWith("✓") ? "pub-success" : "pub-error"}>{assignMsg}</p>}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
