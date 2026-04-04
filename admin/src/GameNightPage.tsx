import { useState } from "react";
import { useNavigate } from "react-router-dom";

type TabId = "overview" | "games" | "spades" | "hearts" | "diamonds" | "clubs";

const TABS: { id: TabId; label: string; color: string }[] = [
  { id: "overview",  label: "Overview",   color: "#94a3b8" },
  { id: "games",     label: "Game Rules", color: "#94a3b8" },
  { id: "spades",    label: "♠ Spades",   color: "#818cf8" },
  { id: "hearts",    label: "♥ Hearts",   color: "#f87171" },
  { id: "diamonds",  label: "♦ Diamonds", color: "#fbbf24" },
  { id: "clubs",     label: "♣ Clubs",    color: "#4ade80" },
];

const ROUND_SCHEDULE = [
  { round: 1, matches: [{ t1: "Spades", t2: "Hearts", game: "Pool (8-Ball)" }, { t1: "Diamonds", t2: "Clubs", game: "Pool (8-Ball)" }] },
  { round: 2, matches: [{ t1: "Spades", t2: "Diamonds", game: "Ping Pong" }, { t1: "Hearts", t2: "Clubs", game: "Ping Pong" }] },
  { round: 3, matches: [{ t1: "Spades", t2: "Clubs", game: "Tabletop Shuffleboard" }, { t1: "Hearts", t2: "Diamonds", game: "Tabletop Shuffleboard" }] },
  { round: 4, matches: [{ t1: "Spades", t2: "Hearts", game: "Cornhole" }, { t1: "Diamonds", t2: "Clubs", game: "Cornhole" }] },
  { round: 5, matches: [{ t1: "Spades", t2: "Diamonds", game: "Connect Four" }, { t1: "Hearts", t2: "Clubs", game: "Connect Four" }] },
  { round: 6, matches: [{ t1: "Spades", t2: "Clubs", game: "Indoor Putting" }, { t1: "Hearts", t2: "Diamonds", game: "Indoor Putting" }] },
];

const TEAM_COLORS: Record<string, string> = {
  Spades: "#818cf8",
  Hearts: "#f87171",
  Diamonds: "#fbbf24",
  Clubs: "#4ade80",
};

const GAMES = [
  {
    name: "Pool (8-Ball)",
    players: "1 vs 1",
    rules: [
      "Standard 8-ball, one rack.",
      "Table is open after the break until a player legally pockets a called object ball.",
      "Call pocket required only for the 8-ball. Slop counts for all other legally struck balls.",
      "A scratch gives the opponent ball-in-hand.",
      "Pocketing the 8-ball early or on a scratch is a loss.",
    ],
    tiebreak: "Count legally pocketed balls from each player's assigned group. Most wins. If still tied: one sudden-death shot from behind the head string.",
  },
  {
    name: "Ping Pong",
    players: "1 vs 1",
    rules: [
      "One game to 15 points.",
      "Win by 2, capped at 17.",
      "Serve changes every 2 points.",
      "Legal serve must bounce once on each side.",
      "Net serve that lands legally is a let — replay.",
    ],
    tiebreak: "Higher score wins immediately. If tied when time expires: one sudden-death point.",
  },
  {
    name: "Tabletop Shuffleboard",
    players: "1 vs 1",
    rules: [
      "Players alternate sliding pucks from the same end.",
      "Puck must fully cross the nearest scoring line to count.",
      "Pucks hanging over the far edge count if they remain on the table until scoring.",
      "Knocking the opponent's pucks off is legal.",
      "Score only after all pucks in the frame are played.",
      "Play to 11 points.",
    ],
    tiebreak: "Use score after the final completed frame. If tied: each player slides one puck — higher-value legal puck wins.",
  },
  {
    name: "Cornhole",
    players: "2 vs 2",
    rules: [
      "Each team uses four bags of one color.",
      "Bag through the hole = 3 points. Bag on the board = 1 point. Bag on the ground or bounced = 0.",
      "Cancellation scoring — only one team scores net points per inning.",
      "Play to 15. Win by 1, capped at 17.",
    ],
    tiebreak: "Higher score wins after the current inning is completed. If tied: one sudden-death inning.",
  },
  {
    name: "Connect Four",
    players: "1 vs 1",
    rules: [
      "Players alternate dropping one disc at a time.",
      "First to connect four discs horizontally, vertically, or diagonally wins.",
      "No player may touch, remove, or shift a disc after it has been dropped.",
      "If a disc lands in the wrong column by accident, it stays.",
    ],
    tiebreak: "Should finish quickly. If time expires: next legal move creating four-in-a-row wins. If neither can, restart with one sudden-death game.",
  },
  {
    name: "Indoor Putting",
    players: "1 vs 1",
    rules: [
      "4 holes total.",
      "Cup placement chosen alternately by each team before each hole.",
      "Cup must be at least 6 ft and no more than 15 ft from the starting mark.",
      "No impossible angles, fully blocked paths, or placements against walls.",
      "Both players play the same hole before moving on.",
      "Count every stroke. Lowest total strokes across all 4 holes wins.",
    ],
    tiebreak: "Finish the current hole. If still tied: one sudden-death putt from a host-selected distance.",
  },
];

const TEAM_DATA: Record<string, {
  color: string;
  rounds: { round: number; opponent: string; game: string; players: number }[];
  callouts: string[];
}> = {
  Spades: {
    color: "#818cf8",
    rounds: [
      { round: 1, opponent: "Hearts",   game: "Pool (8-Ball)",         players: 1 },
      { round: 2, opponent: "Diamonds", game: "Ping Pong",             players: 1 },
      { round: 3, opponent: "Clubs",    game: "Tabletop Shuffleboard", players: 1 },
      { round: 4, opponent: "Hearts",   game: "Cornhole",              players: 2 },
      { round: 5, opponent: "Diamonds", game: "Connect Four",          players: 1 },
      { round: 6, opponent: "Clubs",    game: "Indoor Putting",        players: 1 },
    ],
    callouts: [
      "You open the night against Hearts in Pool — be ready immediately at the start.",
      "Your only doubles event is Cornhole in Round 4.",
      "You face each suit once in the back half except Hearts, whom you see again in Cornhole.",
    ],
  },
  Hearts: {
    color: "#f87171",
    rounds: [
      { round: 1, opponent: "Spades",   game: "Pool (8-Ball)",         players: 1 },
      { round: 2, opponent: "Clubs",    game: "Ping Pong",             players: 1 },
      { round: 3, opponent: "Diamonds", game: "Tabletop Shuffleboard", players: 1 },
      { round: 4, opponent: "Spades",   game: "Cornhole",              players: 2 },
      { round: 5, opponent: "Clubs",    game: "Connect Four",          players: 1 },
      { round: 6, opponent: "Diamonds", game: "Indoor Putting",        players: 1 },
    ],
    callouts: [
      "You begin and revisit Spades in the only doubles round — plan your Cornhole pairing early.",
      "Rounds 2 and 5 are both against Clubs in fast singles events; do not get caught shorthanded.",
      "Your last round is Putting against Diamonds — save a calm putter for the finish.",
    ],
  },
  Diamonds: {
    color: "#fbbf24",
    rounds: [
      { round: 1, opponent: "Clubs",    game: "Pool (8-Ball)",         players: 1 },
      { round: 2, opponent: "Spades",   game: "Ping Pong",             players: 1 },
      { round: 3, opponent: "Hearts",   game: "Tabletop Shuffleboard", players: 1 },
      { round: 4, opponent: "Clubs",    game: "Cornhole",              players: 2 },
      { round: 5, opponent: "Spades",   game: "Connect Four",          players: 1 },
      { round: 6, opponent: "Hearts",   game: "Indoor Putting",        players: 1 },
    ],
    callouts: [
      "You see Clubs twice: first in Pool and later in Cornhole — use different players if possible.",
      "You play Spades in Rounds 2 and 5, both short singles matches — prepare those players in advance.",
      "Your final match is Putting against Hearts, which could affect final standings late.",
    ],
  },
  Clubs: {
    color: "#4ade80",
    rounds: [
      { round: 1, opponent: "Diamonds", game: "Pool (8-Ball)",         players: 1 },
      { round: 2, opponent: "Hearts",   game: "Ping Pong",             players: 1 },
      { round: 3, opponent: "Spades",   game: "Tabletop Shuffleboard", players: 1 },
      { round: 4, opponent: "Diamonds", game: "Cornhole",              players: 2 },
      { round: 5, opponent: "Hearts",   game: "Connect Four",          players: 1 },
      { round: 6, opponent: "Spades",   game: "Indoor Putting",        players: 1 },
    ],
    callouts: [
      "You open with Diamonds in Pool and see them again in Cornhole — plan singles and doubles specialists separately.",
      "Rounds 2 and 5 are both against Hearts in quick games — be at the station before the clock starts.",
      "Your final match is Putting against Spades — make sure your best putter is still available.",
    ],
  },
};

function OverviewCard() {
  return (
    <div className="gn-card" style={{ borderLeftColor: "#94a3b8" }}>
      <p className="gn-card-title">Boyz Weekend Game Night</p>
      <p className="gn-card-subtitle">6-game head-to-head team tournament · 4 teams · ~2 hrs 15 min</p>

      <p className="gn-section-heading">Scoring</p>
      <ul className="gn-rule-list">
        <li>Win = <strong style={{ color: "#4ade80" }}>3 points</strong> · Loss = 0 points</li>
        <li>Max possible per team: 18 points (6 wins × 3)</li>
        <li>Tiebreakers: Total wins → Head-to-head → Point differential → Sudden-death playoff (Connect Four or Putting, host choice)</li>
      </ul>

      <p className="gn-section-heading">Event Flow</p>
      <div className="gn-flow">
        {[
          { time: "0:00 – 0:10",  label: "Setup & Briefing",  note: "Confirm teams, review rules and station locations" },
          { time: "0:10 – 1:40",  label: "Tournament",         note: "6 rounds · 12 min play + 3 min transition each" },
          { time: "1:40 – 1:55",  label: "Standings Break",    note: "Finalize seeds · Announce 1–4 · Reset for finals" },
          { time: "1:55 – 2:15",  label: "Finals",             note: "Championship: 1st vs 2nd · Consolation: 3rd vs 4th" },
        ].map((row, i) => (
          <div key={i} className="gn-flow-row">
            <span className="gn-flow-time">{row.time}</span>
            <span className="gn-flow-label">{row.label}</span>
            <span className="gn-flow-note">{row.note}</span>
          </div>
        ))}
      </div>

      <p className="gn-section-heading">Captain Rules</p>
      <ul className="gn-rule-list">
        <li>Captains are assigned before the event begins.</li>
        <li>Captains ensure the correct player(s) are at the station on time.</li>
        <li>Report final match result to the scorekeeper within 2 minutes after the round ends.</li>
        <li>Captains handle quick rules questions first. Unresolved disputes go to the host immediately.</li>
      </ul>

      <p className="gn-section-heading">Player Rotation</p>
      <ul className="gn-rule-list">
        <li>Every team member should play at least 2 matches.</li>
        <li>No player should play more than 4 matches (unless team has only 3 players).</li>
        <li>No player should play more than 2 consecutive rounds unless required by team size.</li>
        <li>Decide players before each round to avoid delay.</li>
      </ul>

      <p className="gn-section-heading">General Rules</p>
      <ul className="gn-rule-list">
        <li>Each team plays every game exactly once and exactly one match per round.</li>
        <li>Matches begin when the timekeeper starts the clock — not when players feel ready.</li>
        <li>No practice shots, warmup points, or extra turns after the round clock starts.</li>
        <li>Unfinished match when time expires → posted tiebreak rule applies immediately.</li>
        <li className="gn-penalty">Unsportsmanlike conduct or intentional stalling → warning, loss of turn, or forfeit at host's discretion.</li>
        <li>Momentum matters more than perfect officiating. Fast rulings are preferred.</li>
      </ul>
    </div>
  );
}

function GamesCard() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="gn-games-list">
      {GAMES.map((g) => (
        <div key={g.name} className="gn-game-block">
          <button
            className="gn-game-toggle"
            onClick={() => setOpen(open === g.name ? null : g.name)}
          >
            <span className="gn-game-name">{g.name}</span>
            <span className="gn-game-meta">{g.players}</span>
            <span className="gn-game-chevron">{open === g.name ? "▲" : "▼"}</span>
          </button>
          {open === g.name && (
            <div className="gn-game-detail">
              <p className="gn-section-heading">Rules</p>
              <ul className="gn-rule-list">
                {g.rules.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
              <p className="gn-section-heading" style={{ marginTop: "0.5rem" }}>Tiebreak if time expires</p>
              <p className="gn-tiebreak">{g.tiebreak}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ScheduleTable() {
  return (
    <div className="gn-card" style={{ borderLeftColor: "#94a3b8" }}>
      <p className="gn-card-title">Round Schedule</p>
      {ROUND_SCHEDULE.map(({ round, matches }) => (
        <div key={round} className="gn-round-block">
          <p className="gn-section-heading">Round {round}</p>
          <div className="gn-round-matches">
            {matches.map((m, i) => (
              <div key={i} className="gn-match-row">
                <span className="gn-match-game">{m.game}</span>
                <span className="gn-match-teams">
                  <span style={{ color: TEAM_COLORS[m.t1] }}>{m.t1}</span>
                  {" vs "}
                  <span style={{ color: TEAM_COLORS[m.t2] }}>{m.t2}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TeamCard({ teamName }: { teamName: string }) {
  const data = TEAM_DATA[teamName];
  return (
    <div className="gn-card" style={{ borderLeftColor: data.color }}>
      <p className="gn-card-title" style={{ color: data.color }}>{teamName === "Spades" ? "♠" : teamName === "Hearts" ? "♥" : teamName === "Diamonds" ? "♦" : "♣"} {teamName}</p>

      <p className="gn-section-heading">Your Schedule</p>
      <div className="gn-team-schedule">
        {data.rounds.map((r) => (
          <div key={r.round} className="gn-team-row">
            <span className="gn-team-round">R{r.round}</span>
            <span className="gn-team-game">{r.game}</span>
            <span className="gn-team-vs">
              vs <span style={{ color: TEAM_COLORS[r.opponent] }}>{r.opponent}</span>
            </span>
            <span className="gn-team-players">{r.players === 2 ? "2 players" : "1 player"}</span>
          </div>
        ))}
      </div>

      <p className="gn-section-heading">Notes</p>
      <ul className="gn-rule-list">
        {data.callouts.map((c, i) => <li key={i}>{c}</li>)}
      </ul>
    </div>
  );
}

export default function GameNightPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  return (
    <div className="pub-page">
      <header className="pub-header">
        <button className="pub-back" onClick={() => navigate("/")}>← Home</button>
        <h1>Game Night</h1>
        <span className="pub-header-sub">Boyz Weekend 2026 · San Francisco</span>
      </header>

      <div className="pubcrawl-tabs">
        {TABS.map((tab) => (
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
        {activeTab === "overview"  && (
          <>
            <OverviewCard />
            <ScheduleTable />
          </>
        )}
        {activeTab === "games"    && <GamesCard />}
        {activeTab === "spades"   && <TeamCard teamName="Spades" />}
        {activeTab === "hearts"   && <TeamCard teamName="Hearts" />}
        {activeTab === "diamonds" && <TeamCard teamName="Diamonds" />}
        {activeTab === "clubs"    && <TeamCard teamName="Clubs" />}
      </div>
    </div>
  );
}
