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

const SUIT_ICONS: Record<string, string> = {
  SPADES:   "♠",
  HEARTS:   "♥",
  DIAMONDS: "♦",
  CLUBS:    "♣",
};

const SUIT_COLORS: Record<string, string> = {
  SPADES:   "#818cf8",
  HEARTS:   "#f87171",
  DIAMONDS: "#fbbf24",
  CLUBS:    "#4ade80",
};

export default function StandingsPage() {
  const navigate = useNavigate();
  const [leaderboard, setLeaderboard] = useState<LeaderboardTeam[]>([]);
  const [teams, setTeams] = useState<JoinTeamOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Admin assignment section
  const [adminPw, setAdminPw] = useState("");
  const [adminToken, setAdminToken] = useState(() => sessionStorage.getItem("standings_admin_token") ?? "");
  const [adminLoginError, setAdminLoginError] = useState("");
  const [assignTeamId, setAssignTeamId] = useState("spades");
  const [assignName, setAssignName] = useState("");
  const [assignMsg, setAssignMsg] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);

  const loadData = async () => {
    try {
      const [lbRes, teamsRes] = await Promise.all([
        fetch(`${apiBase}/leaderboard`),
        fetch(`${apiBase}/join/options`),
      ]);
      if (lbRes.ok) {
        const data = await lbRes.json();
        setLeaderboard(data.leaderboard ?? []);
      }
      if (teamsRes.ok) {
        const data = await teamsRes.json();
        setTeams(data.teams ?? []);
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
      } else {
        setAdminLoginError(data.error ?? "Login failed");
      }
    } catch {
      setAdminLoginError("Network error");
    }
  };

  const assignParticipant = async () => {
    if (!assignName.trim()) return;
    setAssignBusy(true);
    setAssignMsg("");
    try {
      const res = await fetch(`${apiBase}/admin/assign-participant`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": adminToken,
        },
        body: JSON.stringify({ teamId: assignTeamId, participantName: assignName.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setAssignMsg(`✓ ${assignName.trim()} added to ${assignTeamId.toUpperCase()}`);
        setAssignName("");
        loadData();
      } else {
        setAssignMsg(`Error: ${data.error ?? "Unknown error"}`);
      }
    } catch {
      setAssignMsg("Network error");
    } finally {
      setAssignBusy(false);
    }
  };

  // Merge leaderboard with team roster data
  const enrichedLeaderboard = leaderboard.map((lb) => {
    const teamInfo = teams.find(
      (t) => t.teamId.toLowerCase() === lb.teamId.toLowerCase()
    );
    return { ...lb, captain: teamInfo?.captainName ?? "—", members: teamInfo?.assignedParticipants ?? [] };
  });

  const suitKey = (teamId: string) => teamId.toUpperCase().split("-")[0] ?? teamId.toUpperCase();

  return (
    <div className="pub-page">
      <header className="pub-header">
        <button className="pub-back" onClick={() => navigate("/")}>← Home</button>
        <h1>Teams &amp; Leaderboard</h1>
        {lastRefresh && (
          <span className="pub-refresh-hint">
            Updated {lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        )}
      </header>

      {loading && <p className="pub-loading">Loading standings…</p>}
      {error && <p className="pub-error">{error}</p>}

      {!loading && enrichedLeaderboard.length === 0 && (
        <p className="pub-empty">Hunt hasn't started yet. Check back soon!</p>
      )}

      <div className="standings-grid">
        {enrichedLeaderboard.map((team, idx) => {
          const suit = suitKey(team.teamId);
          const color = SUIT_COLORS[suit] ?? "#94a3b8";
          const icon  = SUIT_ICONS[suit] ?? "★";
          return (
            <div key={team.teamId} className="standings-card" style={{ borderLeftColor: color }}>
              <div className="standings-rank" style={{ color }}>#{idx + 1}</div>
              <div className="standings-suit" style={{ color }}>{icon}</div>
              <div className="standings-body">
                <div className="standings-name">{team.teamName}</div>
                <div className="standings-score" style={{ color }}>{team.scoreTotal.toLocaleString()} pts</div>
                <div className="standings-clue">Clue {team.currentClueIndex + 1}</div>
                <div className="standings-roster">
                  <span className="standings-captain">👑 {team.captain}</span>
                  {team.members.filter((m) => m !== team.captain).map((m) => (
                    <span key={m} className="standings-member">{m}</span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Admin: Team Assignment */}
      <section className="pub-admin-section">
        <h2>Team Assignment <span className="pub-admin-badge">Admin</span></h2>

        {!adminToken ? (
          <div className="pub-admin-login">
            <input
              type="password"
              placeholder="Admin password"
              value={adminPw}
              onChange={(e) => setAdminPw(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && adminLogin()}
            />
            <button onClick={adminLogin}>Unlock</button>
            {adminLoginError && <p className="pub-error">{adminLoginError}</p>}
          </div>
        ) : (
          <div className="pub-admin-assign">
            <p className="pub-admin-active">Admin unlocked · <button className="pub-link-btn" onClick={() => { setAdminToken(""); sessionStorage.removeItem("standings_admin_token"); }}>Lock</button></p>
            <div className="pub-admin-form">
              <select value={assignTeamId} onChange={(e) => setAssignTeamId(e.target.value)}>
                <option value="spades">♠ Spades</option>
                <option value="hearts">♥ Hearts</option>
                <option value="diamonds">♦ Diamonds</option>
                <option value="clubs">♣ Clubs</option>
              </select>
              <input
                placeholder="Participant name"
                value={assignName}
                onChange={(e) => setAssignName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && assignParticipant()}
              />
              <button onClick={assignParticipant} disabled={assignBusy || !assignName.trim()}>
                {assignBusy ? "Adding…" : "Add to Team"}
              </button>
            </div>
            {assignMsg && <p className={assignMsg.startsWith("✓") ? "pub-success" : "pub-error"}>{assignMsg}</p>}

            <h3>Current Rosters</h3>
            {teams.map((t) => {
              const suit = suitKey(t.teamId);
              const color = SUIT_COLORS[suit] ?? "#94a3b8";
              return (
                <div key={t.teamId} className="pub-roster-row" style={{ borderLeftColor: color }}>
                  <strong style={{ color }}>{SUIT_ICONS[suit] ?? "★"} {t.teamName}</strong>
                  <span> · Captain: {t.captainName || "—"}</span>
                  <div className="pub-roster-members">
                    {t.assignedParticipants.length === 0
                      ? <em>No members assigned yet</em>
                      : t.assignedParticipants.map((m) => <span key={m} className="standings-member">{m}</span>)
                    }
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
