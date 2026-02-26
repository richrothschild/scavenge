import { useState, useEffect, useRef, useCallback } from "react";

// ─── SEED DATA ────────────────────────────────────────────────────────────────
const TEAMS = [
  { id: "spades", name: "SPADES", captain: "Lars", pin: "1111", color: "#1a1a2e", accent: "#4fc3f7", emoji: "♠️" },
  { id: "hearts", name: "HEARTS", captain: "Carl", pin: "2222", color: "#1a0a0a", accent: "#f48fb1", emoji: "♥️" },
  { id: "diamonds", name: "DIAMONDS", captain: "Rich", pin: "3333", color: "#0a1a0a", accent: "#a5d6a7", emoji: "♦️" },
  { id: "clubs", name: "CLUBS", captain: "Dave", pin: "4444", color: "#12100a", accent: "#ffcc80", emoji: "♣️" },
];

const CLUES = [
  { id: 1, title: "Opening Salvo", instructions: "Find the sea lion colony near Pier 39. Photograph your full team with at least 3 sea lions visible in the background.", required: false, transport: "WALK", requiresScan: true, type: "PHOTO", rubric: "PASS if sea lions visible + all 4 members present + Pier 39 context clear.", points: 100 },
  { id: 2, title: "Fisherman's Secret", instructions: "Locate the oldest crab pot display at Fisherman's Wharf. Get a photo with the team recreating the pose of the fisherman statue.", required: false, transport: "WALK", requiresScan: true, type: "PHOTO", rubric: "PASS if fisherman statue visible + team recreating pose.", points: 100 },
  { id: 3, title: "Giants Proof", instructions: "Find something within walking distance that clearly shows the San Francisco Giants (logo, signage, apparel, or a Giants-related display). Take a photo that includes: (1) the Giants reference, (2) your full team in the frame, (3) a visible landmark so we know you're in SF.", required: false, transport: "WALK", requiresScan: true, type: "PHOTO", rubric: "PASS if Giants reference unambiguous + all 4 members visible + SF context.", points: 100 },
  { id: 4, title: "The Long Con", instructions: "Find a street performer or busker near the waterfront. Convince them to do something ridiculous. Document it.", required: false, transport: "WALK", requiresScan: true, type: "VIDEO", rubric: "PASS if performer + team visible + some ridiculous thing happens.", points: 120 },
  { id: 5, title: "49ers Proof", instructions: "Record a 10–20 second video of your team doing a 49ers-themed moment (chant, pose, or 'touchdown' celebration). In the video: (1) say the phrase 'Boyz Weekend 2026', (2) show all 4 team members, (3) include something that ties it to SF.", required: false, transport: "WALK", requiresScan: true, type: "VIDEO", rubric: "PASS if 10-20s + phrase spoken + all members + 49ers theme clear.", points: 120 },
  { id: 6, title: "The Wharf Trivia", instructions: "Ask a local (not a tourist) to tell you one fact about SF history. Record their answer and your team reacting to it.", required: false, transport: "WALK", requiresScan: true, type: "VIDEO", rubric: "PASS if local person speaks + team visible + historical fact mentioned.", points: 100 },
  { id: 7, title: "Waymo to Lombard", instructions: "🚗 REQUIRED: Take a Waymo ride to 1083 Lombard Street, San Francisco, CA. Scan the QR code at the Lombard Street checkpoint to confirm your arrival. Get a photo of your whole team on the crooked street.", required: true, transport: "WAYMO", requiresScan: true, type: "PHOTO", rubric: "PASS if photo shows team at Lombard Street. All members visible.", points: 150 },
  { id: 8, title: "The Crooked Truth", instructions: "Standing on Lombard Street, each team member must confess their most embarrassing moment from any previous Boyz Weekend. Record the group confessional.", required: false, transport: "WALK", requiresScan: false, type: "VIDEO", rubric: "PASS if all 4 members speak + Lombard Street visible in background.", points: 130 },
  { id: 9, title: "Ghirardelli Recon", instructions: "Make it to Ghirardelli Square. Get a photo of the team performing a synchronized jump in front of the Ghirardelli sign.", required: false, transport: "WALK", requiresScan: true, type: "PHOTO", rubric: "PASS if Ghirardelli sign clear + all members mid-air (or attempting to be).", points: 110 },
  { id: 10, title: "All Aboard the Cable Car", instructions: "🚋 REQUIRED: Board a cable car at Hyde & Beach and ride to the Buena Vista Bar stop. Scan the QR code at the cable car boarding point to confirm. Enjoy the ride — you're almost there!", required: true, transport: "CABLE_CAR", requiresScan: true, type: "PHOTO", rubric: "PASS if team on cable car visible. All members present.", points: 150 },
  { id: 11, title: "The Buena Vista Ritual", instructions: "🍸 REQUIRED — Buena Vista exclusive: Order the famous Irish Coffee. Get a photo of all 4 team members raising their first Irish Coffee of the day in a toast. Someone must say 'Boyz Weekend 2026' audibly.", required: true, transport: "NONE", requiresScan: false, type: "PHOTO", rubric: "PASS if Irish Coffee glasses visible + all 4 members toasting.", points: 175 },
  { id: 12, title: "The Final Roast", instructions: "🏆 REQUIRED — FINAL CLUE: Record a 30–60 second team video where each member delivers a one-sentence roast of another member. Rules: (1) Say 'Boyz Weekend 2026' at the start, (2) All 4 members roast someone, (3) End with a group cheer. Make it legendary.", required: true, transport: "NONE", requiresScan: false, type: "VIDEO", rubric: "PASS if phrase spoken + 4 roasts delivered + group cheer at end. Score for creativity.", points: 200 },
];

const SABOTAGE_CATALOG = [
  { id: "s1", name: "Map Scramble", desc: "Scramble the target team's clue display for 3 minutes with a fake hint overlay.", cost: 50, cooldown: 600, icon: "🗺️" },
  { id: "s2", name: "Time Bomb", desc: "Force the target team to wait 60 seconds before they can submit their next clue.", cost: 75, cooldown: 900, icon: "💣" },
  { id: "s3", name: "Double or Nothing", desc: "Bet 30 points on your own next clue — PASS doubles payout; FAIL costs 30 extra.", cost: 30, cooldown: 1200, icon: "🎲" },
  { id: "s4", name: "Clue Peek", desc: "Reveal the title (but not text) of your next clue immediately.", cost: 40, cooldown: 0, icon: "👁️" },
  { id: "s5", name: "Saboteur's Taunt", desc: "Send an anonymous trash-talk message to a target team's event feed.", cost: 20, cooldown: 300, icon: "📢" },
];

// ─── INITIAL GAME STATE ───────────────────────────────────────────────────────
const initTeamState = () =>
  TEAMS.reduce((acc, t) => {
    acc[t.id] = {
      score: 0,
      sabotageBalance: 200,
      currentClueIndex: 0,
      completedCount: 0,
      skippedCount: 0,
      clueStates: CLUES.map((c) => ({ id: c.id, status: "LOCKED" })),
      events: [],
      sabotageCooldowns: {},
    };
    acc[t.id].clueStates[0].status = "ACTIVE";
    return acc;
  }, {});

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const getEligibility = (ts) => ts.completedCount >= 7 ? "ELIGIBLE" : "INELIGIBLE";
const clampClueIdx = (i) => Math.max(0, Math.min(11, i));
const ts = () => new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

export default function ScavengeApp() {
  const [view, setView] = useState("join"); // join | game | admin
  const [gameStatus, setGameStatus] = useState("PENDING"); // PENDING | RUNNING | PAUSED | ENDED
  const [teamStates, setTeamStates] = useState(initTeamState());
  const [currentUser, setCurrentUser] = useState(null); // { teamId, name, role: CAPTAIN|MEMBER }
  const [adminAlerts, setAdminAlerts] = useState([]);
  const [globalEvents, setGlobalEvents] = useState([
    { time: ts(), msg: "🎮 Game initialized. Waiting for Admin to start.", type: "system" },
  ]);
  const [activeTab, setActiveTab] = useState("clue"); // clue | leaderboard | sabotage | feed
  const [adminTab, setAdminTab] = useState("dashboard"); // dashboard | teams | clues | security
  const [submissionModal, setSubmissionModal] = useState(false);
  const [pinModal, setPinModal] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [joinForm, setJoinForm] = useState({ name: "", teamId: "spades", pin: "" });
  const [qrModal, setQrModal] = useState(false);
  const [qrScanResult, setQrScanResult] = useState(null);
  const [deductModal, setDeductModal] = useState(null); // { teamId }
  const [deductAmount, setDeductAmount] = useState(50);
  const [deductReason, setDeductReason] = useState("");
  const [reopenModal, setReopenModal] = useState(null); // { teamId }
  const [notification, setNotification] = useState(null);
  const notifTimer = useRef(null);

  const pushNotif = useCallback((msg, type = "info") => {
    setNotification({ msg, type });
    clearTimeout(notifTimer.current);
    notifTimer.current = setTimeout(() => setNotification(null), 3000);
  }, []);

  const pushEvent = useCallback((teamId, msg, type = "progress") => {
    const event = { time: ts(), msg, type, teamId };
    setTeamStates((prev) => ({
      ...prev,
      [teamId]: { ...prev[teamId], events: [event, ...prev[teamId].events].slice(0, 50) },
    }));
    setGlobalEvents((prev) => [event, ...prev].slice(0, 100));
  }, []);

  const pushAdminAlert = useCallback((msg, type = "warning") => {
    setAdminAlerts((prev) => [{ time: ts(), msg, type, id: Date.now() }, ...prev].slice(0, 30));
  }, []);

  // ── Join ─────────────────────────────────────────────────────────────────
  const handleJoin = () => {
    if (!joinForm.name.trim()) return pushNotif("Please enter your name.", "error");
    const team = TEAMS.find((t) => t.id === joinForm.teamId);
    let role = "MEMBER";
    if (joinForm.pin) {
      if (joinForm.pin === team.pin) role = "CAPTAIN";
      else return pushNotif("Wrong captain PIN.", "error");
    }
    setCurrentUser({ teamId: team.id, name: joinForm.name, role });
    setView("game");
    setActiveTab("clue");
    pushNotif(`Welcome, ${joinForm.name}! You joined ${team.name} as ${role}.`, "success");
    pushEvent(team.id, `👤 ${joinForm.name} joined as ${role}.`, "member");
  };

  const handleAdminLogin = (pw) => {
    if (pw === "admin2026") {
      setView("admin");
      pushNotif("Admin console unlocked.", "success");
    } else {
      pushNotif("Wrong admin password.", "error");
    }
  };

  // ── Game Actions ──────────────────────────────────────────────────────────
  const advanceClue = useCallback((teamId, mode) => {
    setTeamStates((prev) => {
      const ts = { ...prev[teamId] };
      const idx = ts.currentClueIndex;
      const clue = CLUES[idx];
      const newStates = [...ts.clueStates];

      if (mode === "PASS") {
        if (clue.required) return prev; // guarded by UI
        if (ts.skippedCount >= 5) return prev;
        newStates[idx] = { ...newStates[idx], status: "PASSED" };
        ts.skippedCount += 1;
      } else {
        newStates[idx] = { ...newStates[idx], status: "COMPLETED" };
        const pts = clue.points + (mode === "PASS_VERDICT" ? Math.floor(clue.points * 0.1) : 0);
        ts.score += pts;
        ts.sabotageBalance += Math.floor(pts * 0.2);
        ts.completedCount += 1;
      }

      const nextIdx = idx + 1;
      if (nextIdx < CLUES.length) {
        newStates[nextIdx] = { ...newStates[nextIdx], status: "ACTIVE" };
        ts.currentClueIndex = nextIdx;
      }
      ts.clueStates = newStates;
      return { ...prev, [teamId]: ts };
    });
  }, []);

  const handleSubmit = () => {
    if (!currentUser || currentUser.role !== "CAPTAIN") return;
    const team = TEAMS.find((t) => t.id === currentUser.teamId);
    const idx = teamStates[currentUser.teamId].currentClueIndex;
    const clue = CLUES[idx];

    // Simulate AI judging
    const verdict = Math.random() > 0.2 ? "PASS" : "NEEDS_REVIEW";
    pushNotif(`AI Verdict: ${verdict} — "${clue.title}"`, verdict === "PASS" ? "success" : "warning");
    pushEvent(currentUser.teamId, `📸 ${team.name} submitted "${clue.title}" → AI: ${verdict}`, "submission");
    pushAdminAlert(`📬 ${team.name} submission on "${clue.title}" → ${verdict}`);

    if (verdict === "PASS") {
      advanceClue(currentUser.teamId, "SUBMIT");
      pushEvent(currentUser.teamId, `✅ "${clue.title}" PASSED! +${clue.points} pts`, "progress");
    }
    setSubmissionModal(false);
  };

  const handlePass = () => {
    if (!currentUser || currentUser.role !== "CAPTAIN") return;
    const idx = teamStates[currentUser.teamId].currentClueIndex;
    const clue = CLUES[idx];
    if (clue.required) return pushNotif("Cannot pass a REQUIRED clue.", "error");
    if (teamStates[currentUser.teamId].skippedCount >= 5) return pushNotif("Max skips reached (5).", "error");
    const team = TEAMS.find((t) => t.id === currentUser.teamId);
    advanceClue(currentUser.teamId, "PASS");
    pushEvent(currentUser.teamId, `⏭️ ${team.name} skipped "${clue.title}"`, "skip");
    pushNotif(`Skipped "${clue.title}".`, "warning");
    setPinModal(false);
  };

  const handleQRScan = () => {
    const idx = teamStates[currentUser.teamId].currentClueIndex;
    const clue = CLUES[idx];
    if (!clue.requiresScan) return pushNotif("This clue doesn't require a QR scan.", "info");
    // Simulate token validation
    setTimeout(() => {
      setQrScanResult("VALIDATED");
      pushEvent(currentUser.teamId, `📱 QR scan validated for "${clue.title}"`, "scan");
      pushNotif("QR scan validated! ✓", "success");
    }, 1000);
  };

  const handleSabotage = (action, targetTeamId) => {
    const ts = teamStates[currentUser.teamId];
    if (ts.sabotageBalance < action.cost) return pushNotif("Insufficient sabotage balance.", "error");
    const lastUsed = ts.sabotageCooldowns[action.id];
    if (lastUsed && Date.now() - lastUsed < action.cooldown * 1000) return pushNotif("Action on cooldown!", "error");

    const team = TEAMS.find((t) => t.id === currentUser.teamId);
    const target = TEAMS.find((t) => t.id === targetTeamId);
    setTeamStates((prev) => ({
      ...prev,
      [currentUser.teamId]: {
        ...prev[currentUser.teamId],
        sabotageBalance: prev[currentUser.teamId].sabotageBalance - action.cost,
        sabotageCooldowns: { ...prev[currentUser.teamId].sabotageCooldowns, [action.id]: Date.now() },
      },
    }));
    pushEvent(currentUser.teamId, `${action.icon} ${team.name} used "${action.name}" on ${target?.name || "themselves"}!`, "sabotage");
    if (targetTeamId && targetTeamId !== currentUser.teamId) {
      pushEvent(targetTeamId, `💥 You've been hit with "${action.name}" by an anonymous saboteur!`, "sabotage");
    }
    pushNotif(`${action.icon} "${action.name}" triggered! -${action.cost} pts`, "success");
  };

  // ── Admin Actions ─────────────────────────────────────────────────────────
  const adminAdvance = (teamId) => {
    advanceClue(teamId, "SUBMIT");
    pushEvent(teamId, `🔧 Admin manually advanced team to next clue.`, "admin");
    pushNotif("Team advanced.", "success");
  };

  const adminDeduct = () => {
    if (!deductModal) return;
    const amt = parseInt(deductAmount);
    setTeamStates((prev) => ({
      ...prev,
      [deductModal.teamId]: { ...prev[deductModal.teamId], score: Math.max(0, prev[deductModal.teamId].score - amt) },
    }));
    pushEvent(deductModal.teamId, `⚠️ Admin deducted ${amt} pts: ${deductReason}`, "admin");
    pushNotif(`Deducted ${amt} pts from ${deductModal.teamId}.`, "warning");
    setDeductModal(null);
    setDeductReason("");
  };

  // ── Screenshot sim (for demo) ─────────────────────────────────────────────
  const simulateScreenshot = () => {
    if (!currentUser) return;
    const team = TEAMS.find((t) => t.id === currentUser.teamId);
    const idx = teamStates[currentUser.teamId].currentClueIndex;
    pushAdminAlert(`🚨 SCREENSHOT ATTEMPT — ${team.name} / ${currentUser.name} on Clue ${idx + 1}`, "alert");
    pushEvent(currentUser.teamId, `🔴 A security event was detected on this team.`, "security");
    pushNotif("⚠️ Screenshot attempt detected and logged.", "error");
  };

  // ── Leaderboard ──────────────────────────────────────────────────────────
  const leaderboard = TEAMS.map((t) => ({
    ...t,
    ...teamStates[t.id],
    eligibility: getEligibility(teamStates[t.id]),
  })).sort((a, b) => b.score - a.score);

  // ─── CURRENT USER DATA ────────────────────────────────────────────────────
  const myTeam = currentUser ? TEAMS.find((t) => t.id === currentUser.teamId) : null;
  const myState = currentUser ? teamStates[currentUser.teamId] : null;
  const myClueIdx = myState?.currentClueIndex ?? 0;
  const myCurrentClue = CLUES[myClueIdx];
  const myClueState = myState?.clueStates[myClueIdx];
  const isCaptain = currentUser?.role === "CAPTAIN";

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'Courier New', monospace", background: "#0a0a0f", minHeight: "100vh", color: "#e8e8e8" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --gold: #f0c040;
          --red: #e05c5c;
          --green: #5ccc8c;
          --blue: #4fc3f7;
          --orange: #ff9d5c;
          --bg: #0a0a0f;
          --bg2: #111118;
          --bg3: #1a1a24;
          --border: #2a2a3a;
          --text: #e8e8e8;
          --muted: #6a6a8a;
        }
        .bebas { font-family: 'Bebas Neue', cursive; letter-spacing: 0.05em; }
        .mono { font-family: 'Space Mono', monospace; }
        button { cursor: pointer; border: none; outline: none; }
        input { outline: none; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: var(--bg2); }
        ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
        .tab-btn { background: transparent; color: var(--muted); border-bottom: 2px solid transparent; padding: 8px 12px; font-family: 'Space Mono', monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; transition: all 0.2s; }
        .tab-btn.active { color: var(--gold); border-bottom-color: var(--gold); }
        .tab-btn:hover:not(.active) { color: var(--text); }
        .btn { padding: 10px 20px; border-radius: 4px; font-family: 'Bebas Neue', cursive; letter-spacing: 0.1em; font-size: 16px; transition: all 0.15s; }
        .btn-gold { background: var(--gold); color: #0a0a0f; }
        .btn-gold:hover { background: #ffd060; transform: translateY(-1px); }
        .btn-red { background: var(--red); color: #fff; }
        .btn-red:hover { background: #f06060; }
        .btn-green { background: var(--green); color: #0a0a0f; }
        .btn-green:hover { background: #6cdc9c; }
        .btn-ghost { background: transparent; border: 1px solid var(--border); color: var(--muted); }
        .btn-ghost:hover { border-color: var(--text); color: var(--text); }
        .btn-orange { background: var(--orange); color: #0a0a0f; }
        .card { background: var(--bg3); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
        .pulse { animation: pulse 2s infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 10px; font-family:'Space Mono',monospace; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; }
        .badge-gold { background: #f0c04022; color: var(--gold); border: 1px solid #f0c04044; }
        .badge-red { background: #e05c5c22; color: var(--red); border: 1px solid #e05c5c44; }
        .badge-green { background: #5ccc8c22; color: var(--green); border: 1px solid #5ccc8c44; }
        .badge-blue { background: #4fc3f722; color: var(--blue); border: 1px solid #4fc3f744; }
        .badge-muted { background: #2a2a3a; color: var(--muted); border: 1px solid #3a3a4a; }
        .shine { background: linear-gradient(135deg, #f0c040, #ff9d5c); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
        .notif { position: fixed; top: 20px; right: 20px; z-index: 200; padding: 12px 18px; border-radius: 6px; font-family: 'Space Mono', monospace; font-size: 12px; max-width: 320px; animation: slideIn 0.2s ease; }
        @keyframes slideIn { from { opacity:0; transform: translateX(20px); } to { opacity:1; transform: translateX(0); } }
        .notif-info { background: #1a1a40; border: 1px solid var(--blue); color: var(--blue); }
        .notif-success { background: #0a2a1a; border: 1px solid var(--green); color: var(--green); }
        .notif-warning { background: #2a1a0a; border: 1px solid var(--orange); color: var(--orange); }
        .notif-error { background: #2a0a0a; border: 1px solid var(--red); color: var(--red); }
        .progress-bar { height: 4px; background: var(--bg2); border-radius: 2px; overflow: hidden; }
        .progress-fill { height: 100%; background: linear-gradient(90deg, var(--gold), var(--orange)); border-radius: 2px; transition: width 0.5s ease; }
        .event-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; margin-top: 5px; }
        .dot-progress { background: var(--green); }
        .dot-submission { background: var(--blue); }
        .dot-skip { background: var(--orange); }
        .dot-sabotage { background: var(--red); }
        .dot-admin { background: var(--gold); }
        .dot-system { background: var(--muted); }
        .dot-security { background: var(--red); animation: pulse 1s infinite; }
        .dot-scan { background: var(--blue); }
        .dot-member { background: var(--muted); }
        .clue-num { font-family:'Bebas Neue',cursive; font-size: 80px; line-height:1; opacity:0.08; position: absolute; right:12px; bottom:0; }
        .transport-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-family: 'Space Mono', monospace; font-weight: 700; text-transform: uppercase; }
        .transport-WALK { background:#1a2a1a; color:#5ccc8c; border:1px solid #5ccc8c44; }
        .transport-WAYMO { background:#1a1a2a; color:#4fc3f7; border:1px solid #4fc3f744; }
        .transport-CABLE_CAR { background:#2a1a0a; color:#ff9d5c; border:1px solid #ff9d5c44; }
        .transport-NONE { background:#1a1a1a; color:#6a6a8a; border:1px solid #3a3a3a; }
        .rank-1 { color: var(--gold); }
        .rank-2 { color: #c0c0c0; }
        .rank-3 { color: #cd7f32; }
        .team-card { border-radius:8px; overflow:hidden; }
        select { background: var(--bg3); border: 1px solid var(--border); color: var(--text); padding: 10px 12px; border-radius: 4px; font-family:'Space Mono',monospace; font-size: 12px; width:100%; }
        input[type=text], input[type=password], input[type=number] { background: var(--bg3); border: 1px solid var(--border); color: var(--text); padding: 10px 12px; border-radius: 4px; font-family:'Space Mono',monospace; font-size: 12px; width:100%; }
        input:focus { border-color: var(--gold); }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .alert-item { padding:10px 12px; border-radius:6px; border-left:3px solid; font-size:11px; font-family:'Space Mono',monospace; }
        .alert-warning { background:#1a1200; border-color: var(--gold); }
        .alert-alert { background:#1a0000; border-color: var(--red); animation: pulse 1.5s infinite; }
        .hint-text { font-size:10px; color:var(--muted); font-family:'Space Mono',monospace; }
      `}</style>

      {/* NOTIFICATION */}
      {notification && (
        <div className={`notif notif-${notification.type}`}>{notification.msg}</div>
      )}

      {/* ── JOIN SCREEN ───────────────────────────────────────────────────── */}
      {view === "join" && <JoinScreen joinForm={joinForm} setJoinForm={setJoinForm} onJoin={handleJoin} onAdminLogin={handleAdminLogin} pushNotif={pushNotif} />}

      {/* ── GAME SCREEN ──────────────────────────────────────────────────── */}
      {view === "game" && currentUser && (
        <div style={{ maxWidth: 480, margin: "0 auto", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
          {/* Header */}
          <div style={{ background: "linear-gradient(135deg, #111118, #1a1a24)", borderBottom: "1px solid #2a2a3a", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 10 }}>
            <div>
              <div className="bebas shine" style={{ fontSize: 24 }}>SCAVENGE</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
                <span style={{ fontSize: 14 }}>{myTeam?.emoji}</span>
                <span style={{ fontSize: 11, color: "#6a6a8a", fontFamily: "'Space Mono', monospace" }}>{myTeam?.name}</span>
                <span className={`badge ${isCaptain ? "badge-gold" : "badge-muted"}`}>{isCaptain ? "CAPTAIN" : "MEMBER"}</span>
                <span className={`badge ${gameStatus === "RUNNING" ? "badge-green" : gameStatus === "PAUSED" ? "badge-gold" : "badge-muted"}`}>{gameStatus}</span>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="bebas" style={{ fontSize: 24, color: "var(--gold)" }}>{myState?.score ?? 0}</div>
              <div style={{ fontSize: 10, color: "#6a6a8a", fontFamily: "'Space Mono', monospace" }}>POINTS</div>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ padding: "8px 16px 0", background: "#111118" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: "#6a6a8a", fontFamily: "Space Mono" }}>Clue {myClueIdx + 1} of 12 · {myState?.completedCount ?? 0} done · {myState?.skippedCount ?? 0}/5 skips</span>
              <span className={`badge ${getEligibility(myState) === "ELIGIBLE" ? "badge-green" : "badge-red"}`}>{getEligibility(myState)}</span>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${((myState?.completedCount ?? 0) / 12) * 100}%` }} />
            </div>
          </div>

          {/* Tabs */}
          <div style={{ borderBottom: "1px solid #2a2a3a", display: "flex", background: "#111118", paddingTop: 8 }}>
            {[
              { id: "clue", label: "Clue" },
              { id: "leaderboard", label: "Board" },
              { id: "sabotage", label: "Sabotage" },
              { id: "feed", label: "Feed" },
            ].map((t) => (
              <button key={t.id} className={`tab-btn ${activeTab === t.id ? "active" : ""}`} onClick={() => setActiveTab(t.id)}>
                {t.label}
                {t.id === "feed" && myState?.events?.some((e) => e.type === "security") && (
                  <span style={{ marginLeft: 4, width: 6, height: 6, borderRadius: "50%", background: "var(--red)", display: "inline-block" }} />
                )}
              </button>
            ))}
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
            {activeTab === "clue" && (
              <ClueTab
                clue={myCurrentClue}
                clueIdx={myClueIdx}
                clueState={myClueState}
                isCaptain={isCaptain}
                gameStatus={gameStatus}
                qrScanResult={qrScanResult}
                myState={myState}
                onSubmit={() => setSubmissionModal(true)}
                onPass={handlePass}
                onQRScan={() => { setQrModal(true); setTimeout(() => { handleQRScan(); setQrModal(false); }, 1500); }}
                onScreenshotSim={simulateScreenshot}
              />
            )}
            {activeTab === "leaderboard" && <LeaderboardTab leaderboard={leaderboard} myTeamId={currentUser.teamId} />}
            {activeTab === "sabotage" && (
              <SabotageTab
                catalog={SABOTAGE_CATALOG}
                myState={myState}
                isCaptain={isCaptain}
                myTeamId={currentUser.teamId}
                teams={TEAMS}
                onTrigger={handleSabotage}
              />
            )}
            {activeTab === "feed" && <FeedTab events={myState?.events ?? []} globalEvents={globalEvents} />}
          </div>
        </div>
      )}

      {/* ── ADMIN SCREEN ─────────────────────────────────────────────────── */}
      {view === "admin" && (
        <AdminScreen
          gameStatus={gameStatus}
          setGameStatus={setGameStatus}
          teamStates={teamStates}
          teams={TEAMS}
          clues={CLUES}
          leaderboard={leaderboard}
          adminAlerts={adminAlerts}
          setAdminAlerts={setAdminAlerts}
          globalEvents={globalEvents}
          onAdvance={adminAdvance}
          onDeduct={(teamId) => setDeductModal({ teamId })}
          onBack={() => setView("join")}
          pushEvent={pushEvent}
          pushNotif={pushNotif}
        />
      )}

      {/* ── MODALS ───────────────────────────────────────────────────────── */}
      {submissionModal && (
        <div className="modal-backdrop" onClick={() => setSubmissionModal(false)}>
          <div className="card" style={{ maxWidth: 400, width: "100%" }} onClick={(e) => e.stopPropagation()}>
            <div className="bebas" style={{ fontSize: 22, color: "var(--gold)", marginBottom: 12 }}>Submit Proof</div>
            <p style={{ fontSize: 12, color: "var(--muted)", fontFamily: "Space Mono", marginBottom: 16 }}>
              Clue: <span style={{ color: "var(--text)" }}>{myCurrentClue?.title}</span><br />
              Type: <span style={{ color: "var(--blue)" }}>{myCurrentClue?.type}</span>
            </p>
            <div style={{ border: "2px dashed var(--border)", borderRadius: 8, padding: 24, textAlign: "center", marginBottom: 16, cursor: "pointer" }} onClick={() => {}}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>{myCurrentClue?.type === "VIDEO" ? "🎥" : "📷"}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "Space Mono" }}>Tap to capture {myCurrentClue?.type?.toLowerCase()}<br />(demo: simulates AI judging)</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setSubmissionModal(false)}>Cancel</button>
              <button className="btn btn-gold" style={{ flex: 2 }} onClick={handleSubmit}>Submit & Judge</button>
            </div>
          </div>
        </div>
      )}

      {qrModal && (
        <div className="modal-backdrop">
          <div className="card" style={{ maxWidth: 320, width: "100%", textAlign: "center" }}>
            <div className="bebas" style={{ fontSize: 22, color: "var(--blue)", marginBottom: 12 }}>QR SCANNER</div>
            <div style={{ width: 160, height: 160, margin: "0 auto 16px", border: "2px solid var(--blue)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
              <div style={{ fontSize: 48 }}>📱</div>
              <div className="pulse" style={{ position: "absolute", inset: 0, background: "linear-gradient(0deg, transparent 40%, #4fc3f722 50%, transparent 60%)", animation: "scan 1.5s linear infinite" }} />
            </div>
            <style>{`@keyframes scan { from{transform:translateY(-100%)} to{transform:translateY(100%)} }`}</style>
            <p style={{ fontSize: 11, color: "var(--muted)", fontFamily: "Space Mono" }}>Requesting scan session token…<br />Validating against server…</p>
          </div>
        </div>
      )}

      {deductModal && (
        <div className="modal-backdrop" onClick={() => setDeductModal(null)}>
          <div className="card" style={{ maxWidth: 360, width: "100%" }} onClick={(e) => e.stopPropagation()}>
            <div className="bebas" style={{ fontSize: 20, color: "var(--red)", marginBottom: 12 }}>Deduct Points</div>
            <p style={{ fontSize: 11, fontFamily: "Space Mono", color: "var(--muted)", marginBottom: 12 }}>
              Team: <strong style={{ color: "var(--text)" }}>{TEAMS.find(t => t.id === deductModal.teamId)?.name}</strong>
            </p>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 10, color: "var(--muted)", fontFamily: "Space Mono", display: "block", marginBottom: 4 }}>AMOUNT</label>
              <input type="number" value={deductAmount} onChange={(e) => setDeductAmount(e.target.value)} min={1} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 10, color: "var(--muted)", fontFamily: "Space Mono", display: "block", marginBottom: 4 }}>REASON (required)</label>
              <input type="text" value={deductReason} onChange={(e) => setDeductReason(e.target.value)} placeholder="e.g. Screenshot violation" />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setDeductModal(null)}>Cancel</button>
              <button className="btn btn-red" style={{ flex: 2 }} onClick={adminDeduct} disabled={!deductReason}>Deduct Points</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── JOIN SCREEN ─────────────────────────────────────────────────────────────
function JoinScreen({ joinForm, setJoinForm, onJoin, onAdminLogin, pushNotif }) {
  const [adminPw, setAdminPw] = useState("");
  const [showAdmin, setShowAdmin] = useState(false);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, background: "radial-gradient(ellipse at 50% 0%, #1a1a2e 0%, #0a0a0f 60%)" }}>
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <div className="bebas" style={{ fontSize: 72, lineHeight: 1, background: "linear-gradient(135deg, #f0c040, #ff9d5c, #e05c5c)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>SCAVENGE</div>
        <div style={{ fontFamily: "Space Mono", fontSize: 12, color: "#6a6a8a", letterSpacing: "0.3em", marginTop: 4 }}>BOYZ WEEKEND 2026 · SAN FRANCISCO</div>
        <div style={{ fontFamily: "Space Mono", fontSize: 10, color: "#3a3a5a", marginTop: 4 }}>APR 11 · ZEPHYR HOTEL → BUENA VISTA BAR</div>
      </div>

      <div style={{ width: "100%", maxWidth: 380 }}>
        {!showAdmin ? (
          <div className="card">
            <div className="bebas" style={{ fontSize: 18, color: "var(--gold)", marginBottom: 16 }}>JOIN THE HUNT</div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 10, color: "var(--muted)", fontFamily: "Space Mono", display: "block", marginBottom: 4 }}>YOUR NAME</label>
              <input type="text" value={joinForm.name} onChange={(e) => setJoinForm({ ...joinForm, name: e.target.value })} placeholder="Enter display name" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 10, color: "var(--muted)", fontFamily: "Space Mono", display: "block", marginBottom: 4 }}>TEAM</label>
              <select value={joinForm.teamId} onChange={(e) => setJoinForm({ ...joinForm, teamId: e.target.value })}>
                <option value="spades">♠️ Spades (Captain: Lars)</option>
                <option value="hearts">♥️ Hearts (Captain: Carl)</option>
                <option value="diamonds">♦️ Diamonds (Captain: Rich)</option>
                <option value="clubs">♣️ Clubs (Captain: Dave)</option>
              </select>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 10, color: "var(--muted)", fontFamily: "Space Mono", display: "block", marginBottom: 4 }}>CAPTAIN PIN <span style={{ color: "#3a3a5a" }}>(optional — leave blank for member)</span></label>
              <input type="password" value={joinForm.pin} onChange={(e) => setJoinForm({ ...joinForm, pin: e.target.value })} placeholder="4-digit captain PIN" maxLength={4} />
              <div className="hint-text" style={{ marginTop: 4 }}>Demo PINs: Spades=1111 · Hearts=2222 · Diamonds=3333 · Clubs=4444</div>
            </div>
            <button className="btn btn-gold" style={{ width: "100%", fontSize: 18 }} onClick={onJoin}>ENTER THE HUNT →</button>
            <button className="btn btn-ghost" style={{ width: "100%", marginTop: 8, fontSize: 12 }} onClick={() => setShowAdmin(true)}>Admin Console</button>
          </div>
        ) : (
          <div className="card">
            <div className="bebas" style={{ fontSize: 18, color: "var(--red)", marginBottom: 16 }}>ADMIN ACCESS</div>
            <div style={{ marginBottom: 12 }}>
              <input type="password" value={adminPw} onChange={(e) => setAdminPw(e.target.value)} placeholder="Admin password" onKeyDown={(e) => e.key === "Enter" && onAdminLogin(adminPw)} />
              <div className="hint-text" style={{ marginTop: 4 }}>Demo password: admin2026</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowAdmin(false)}>Back</button>
              <button className="btn btn-red" style={{ flex: 2 }} onClick={() => onAdminLogin(adminPw)}>UNLOCK ADMIN</button>
            </div>
          </div>
        )}
      </div>

      {/* Team cards preview */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 32, width: "100%", maxWidth: 380 }}>
        {TEAMS.map((t) => (
          <div key={t.id} style={{ background: `${t.color}cc`, border: `1px solid ${t.accent}33`, borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 20, marginBottom: 2 }}>{t.emoji}</div>
            <div className="bebas" style={{ fontSize: 16, color: t.accent }}>{t.name}</div>
            <div style={{ fontSize: 10, color: "#6a6a8a", fontFamily: "Space Mono" }}>CPT: {t.captain}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── CLUE TAB ────────────────────────────────────────────────────────────────
function ClueTab({ clue, clueIdx, clueState, isCaptain, gameStatus, qrScanResult, myState, onSubmit, onPass, onQRScan, onScreenshotSim }) {
  const transportIcons = { WALK: "🚶", WAYMO: "🚗", CABLE_CAR: "🚋", NONE: "📍" };
  const gameRunning = gameStatus === "RUNNING";

  return (
    <div>
      {!gameRunning && (
        <div style={{ background: "#1a1a0a", border: "1px solid var(--gold)", borderRadius: 8, padding: 12, marginBottom: 16, textAlign: "center" }}>
          <div style={{ fontFamily: "Space Mono", fontSize: 11, color: "var(--gold)" }}>
            {gameStatus === "PENDING" ? "⏳ Waiting for Admin to start the game…" : gameStatus === "PAUSED" ? "⏸️ Game is paused. Hang tight." : "🏁 Game has ended."}
          </div>
        </div>
      )}

      <div className="card" style={{ position: "relative", overflow: "hidden", marginBottom: 16 }}>
        <div className="clue-num">{clueIdx + 1}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <span className={`transport-badge transport-${clue?.transport || "NONE"}`}>
            {transportIcons[clue?.transport || "NONE"]} {clue?.transport || "NONE"}
          </span>
          {clue?.required && <span className="badge badge-red">REQUIRED</span>}
          <span className="badge badge-blue">{clue?.type}</span>
          <span className="badge badge-gold">+{clue?.points} pts</span>
        </div>

        <div className="bebas" style={{ fontSize: 26, color: "var(--gold)", marginBottom: 8 }}>{clue?.title}</div>
        <p style={{ fontFamily: "Space Mono", fontSize: 11, color: "#c8c8d8", lineHeight: 1.8 }}>{clue?.instructions}</p>

        {clue?.requiresScan && (
          <div style={{ marginTop: 12, padding: "8px 12px", background: qrScanResult ? "#0a2a0a" : "#0a0a1a", border: `1px solid ${qrScanResult ? "var(--green)" : "var(--blue)"}44`, borderRadius: 6, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14 }}>{qrScanResult ? "✅" : "📲"}</span>
            <span style={{ fontFamily: "Space Mono", fontSize: 10, color: qrScanResult ? "var(--green)" : "var(--blue)" }}>
              {qrScanResult ? "QR Scan Validated" : "QR Check-in Required"}
            </span>
          </div>
        )}
      </div>

      {/* Progress summary */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
        {[
          { label: "COMPLETED", value: myState?.completedCount ?? 0, color: "var(--green)" },
          { label: "SKIPS USED", value: `${myState?.skippedCount ?? 0}/5`, color: "var(--orange)" },
          { label: "NEED 7+ TO WIN", value: `${Math.max(0, 7 - (myState?.completedCount ?? 0))} more`, color: "var(--gold)" },
        ].map((s) => (
          <div key={s.label} className="card" style={{ textAlign: "center", padding: 10 }}>
            <div className="bebas" style={{ fontSize: 20, color: s.color }}>{s.value}</div>
            <div style={{ fontFamily: "Space Mono", fontSize: 8, color: "var(--muted)", marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Captain Actions */}
      {isCaptain && gameRunning && (
        <div>
          <div style={{ fontFamily: "Space Mono", fontSize: 10, color: "var(--muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.1em" }}>Captain Actions</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {clue?.requiresScan && !qrScanResult && (
              <button className="btn" style={{ background: "var(--blue)", color: "#0a0a0f", fontSize: 15 }} onClick={onQRScan}>
                📲 SCAN QR CODE
              </button>
            )}
            <button className="btn btn-green" style={{ fontSize: 16 }} onClick={onSubmit}>
              📸 SUBMIT PROOF
            </button>
            {!clue?.required && (
              <button className="btn btn-ghost" style={{ fontSize: 14, color: "var(--orange)", borderColor: "var(--orange)" }} onClick={onPass}>
                ⏭️ PASS THIS CLUE ({5 - (myState?.skippedCount ?? 0)} skips remaining)
              </button>
            )}
            {clue?.required && (
              <div style={{ padding: "8px 12px", background: "#1a0a0a", border: "1px solid #e05c5c44", borderRadius: 6 }}>
                <span style={{ fontFamily: "Space Mono", fontSize: 10, color: "var(--red)" }}>🔒 REQUIRED — cannot be skipped</span>
              </div>
            )}
          </div>
        </div>
      )}

      {!isCaptain && (
        <div style={{ padding: "10px 14px", background: "#111118", border: "1px solid var(--border)", borderRadius: 6, marginTop: 8 }}>
          <span style={{ fontFamily: "Space Mono", fontSize: 10, color: "var(--muted)" }}>👁️ Member view — captain controls submission and progression</span>
        </div>
      )}

      {/* Demo controls */}
      <div style={{ marginTop: 24, padding: 12, background: "#0a0a0f", border: "1px dashed #2a2a3a", borderRadius: 6 }}>
        <div style={{ fontFamily: "Space Mono", fontSize: 9, color: "#3a3a5a", marginBottom: 8 }}>DEMO CONTROLS</div>
        <button className="btn btn-ghost" style={{ fontSize: 11, padding: "6px 12px" }} onClick={onScreenshotSim}>
          📷 Simulate Screenshot Attempt
        </button>
      </div>
    </div>
  );
}

// ─── LEADERBOARD TAB ─────────────────────────────────────────────────────────
function LeaderboardTab({ leaderboard, myTeamId }) {
  const rankColors = ["var(--gold)", "#c0c0c0", "#cd7f32", "var(--muted)"];
  return (
    <div>
      <div className="bebas" style={{ fontSize: 22, color: "var(--text)", marginBottom: 16 }}>LIVE LEADERBOARD</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {leaderboard.map((team, i) => (
          <div key={team.id} className="card" style={{ borderColor: team.id === myTeamId ? team.accent : "var(--border)", transition: "all 0.3s" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div className="bebas" style={{ fontSize: 32, color: rankColors[i] || "var(--muted)", width: 28, textAlign: "center" }}>{i + 1}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 18 }}>{team.emoji}</span>
                  <span className="bebas" style={{ fontSize: 20, color: team.id === myTeamId ? team.accent : "var(--text)" }}>{team.name}</span>
                  <span className={`badge ${team.eligibility === "ELIGIBLE" ? "badge-green" : "badge-red"}`}>{team.eligibility}</span>
                  {team.id === myTeamId && <span className="badge badge-blue">YOU</span>}
                </div>
                <div style={{ display: "flex", gap: 12, fontSize: 10, fontFamily: "Space Mono", color: "var(--muted)" }}>
                  <span>Clue {team.currentClueIndex + 1}/12</span>
                  <span>{team.completedCount} done</span>
                  <span>{team.skippedCount}/5 skips</span>
                </div>
                <div className="progress-bar" style={{ marginTop: 6 }}>
                  <div className="progress-fill" style={{ width: `${(team.completedCount / 12) * 100}%` }} />
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="bebas" style={{ fontSize: 28, color: team.id === myTeamId ? team.accent : "var(--gold)" }}>{team.score}</div>
                <div style={{ fontSize: 9, fontFamily: "Space Mono", color: "var(--muted)" }}>PTS</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SABOTAGE TAB ────────────────────────────────────────────────────────────
function SabotageTab({ catalog, myState, isCaptain, myTeamId, teams, onTrigger }) {
  const [selectedTarget, setSelectedTarget] = useState({});

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div className="bebas" style={{ fontSize: 22 }}>SABOTAGE STORE</div>
        <div>
          <span className="badge badge-gold">💰 {myState?.sabotageBalance ?? 0} pts</span>
        </div>
      </div>

      {!isCaptain && (
        <div style={{ padding: "8px 12px", background: "#111118", border: "1px solid var(--border)", borderRadius: 6, marginBottom: 12 }}>
          <span style={{ fontFamily: "Space Mono", fontSize: 10, color: "var(--muted)" }}>👁️ Member view — only captain can trigger sabotage actions</span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {catalog.map((action) => {
          const canAfford = (myState?.sabotageBalance ?? 0) >= action.cost;
          const targetTeams = teams.filter((t) => t.id !== myTeamId);
          const needsTarget = !["s3", "s4"].includes(action.id);

          return (
            <div key={action.id} className="card" style={{ opacity: canAfford ? 1 : 0.5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 20 }}>{action.icon}</span>
                  <div>
                    <div className="bebas" style={{ fontSize: 16, color: "var(--text)" }}>{action.name}</div>
                    <div style={{ fontFamily: "Space Mono", fontSize: 10, color: "var(--muted)" }}>{action.desc}</div>
                  </div>
                </div>
                <span className="badge badge-red" style={{ fontSize: 12, fontFamily: "'Bebas Neue',cursive", letterSpacing: "0.05em", padding: "4px 10px" }}>-{action.cost}</span>
              </div>

              {isCaptain && (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {needsTarget && (
                    <select value={selectedTarget[action.id] || ""} onChange={(e) => setSelectedTarget({ ...selectedTarget, [action.id]: e.target.value })} style={{ flex: 1, fontSize: 11 }}>
                      <option value="">Select target…</option>
                      {targetTeams.map((t) => <option key={t.id} value={t.id}>{t.emoji} {t.name}</option>)}
                    </select>
                  )}
                  <button
                    className="btn btn-red"
                    style={{ fontSize: 13, padding: "8px 14px", whiteSpace: "nowrap" }}
                    disabled={!canAfford || (needsTarget && !selectedTarget[action.id])}
                    onClick={() => onTrigger(action, needsTarget ? selectedTarget[action.id] : myTeamId)}
                  >
                    TRIGGER
                  </button>
                </div>
              )}
              {action.cooldown > 0 && (
                <div style={{ fontFamily: "Space Mono", fontSize: 9, color: "#3a3a5a", marginTop: 6 }}>Cooldown: {action.cooldown / 60}min</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── FEED TAB ────────────────────────────────────────────────────────────────
function FeedTab({ events, globalEvents }) {
  const [showGlobal, setShowGlobal] = useState(false);
  const feed = showGlobal ? globalEvents : events;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div className="bebas" style={{ fontSize: 22 }}>EVENT FEED</div>
        <div style={{ display: "flex", gap: 4 }}>
          <button className={`tab-btn ${!showGlobal ? "active" : ""}`} onClick={() => setShowGlobal(false)}>My Team</button>
          <button className={`tab-btn ${showGlobal ? "active" : ""}`} onClick={() => setShowGlobal(true)}>All Teams</button>
        </div>
      </div>
      {feed.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, fontFamily: "Space Mono", fontSize: 11, color: "var(--muted)" }}>No events yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {feed.map((e, i) => (
            <div key={i} style={{ display: "flex", gap: 10, padding: "8px 10px", background: "var(--bg3)", borderRadius: 6, borderLeft: `2px solid ${e.type === "security" ? "var(--red)" : e.type === "sabotage" ? "var(--red)" : e.type === "admin" ? "var(--gold)" : e.type === "submission" ? "var(--blue)" : "var(--green)"}` }}>
              <div className={`event-dot dot-${e.type}`} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "Space Mono", fontSize: 11, color: "var(--text)", lineHeight: 1.5 }}>{e.msg}</div>
                <div style={{ fontFamily: "Space Mono", fontSize: 9, color: "var(--muted)", marginTop: 2 }}>{e.time}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ADMIN SCREEN ────────────────────────────────────────────────────────────
function AdminScreen({ gameStatus, setGameStatus, teamStates, teams, clues, leaderboard, adminAlerts, setAdminAlerts, globalEvents, onAdvance, onDeduct, onBack, pushEvent, pushNotif }) {
  const [adminTab, setAdminTab] = useState("dashboard");

  const statusColors = { PENDING: "var(--gold)", RUNNING: "var(--green)", PAUSED: "var(--orange)", ENDED: "var(--muted)" };

  return (
    <div style={{ minHeight: "100vh", background: "radial-gradient(ellipse at 50% 0%, #1a0a0a 0%, #0a0a0f 60%)" }}>
      {/* Admin Header */}
      <div style={{ background: "#111118", borderBottom: "1px solid #3a1a1a", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 10 }}>
        <div>
          <div className="bebas shine" style={{ fontSize: 22 }}>SCAVENGE ADMIN</div>
          <div style={{ fontFamily: "Space Mono", fontSize: 10, color: "var(--muted)" }}>GAME MASTER CONSOLE</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {adminAlerts.length > 0 && (
            <div className="pulse badge badge-red">{adminAlerts.length} ALERTS</div>
          )}
          <div className="badge" style={{ background: `${statusColors[gameStatus]}22`, color: statusColors[gameStatus], border: `1px solid ${statusColors[gameStatus]}44` }}>{gameStatus}</div>
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "6px 12px" }} onClick={onBack}>EXIT</button>
        </div>
      </div>

      {/* Game Controls */}
      <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontFamily: "Space Mono", fontSize: 10, color: "var(--muted)", marginRight: 8 }}>GAME:</div>
        {gameStatus === "PENDING" && <button className="btn btn-green" style={{ fontSize: 14, padding: "8px 16px" }} onClick={() => { setGameStatus("RUNNING"); pushNotif("🏁 Game started!", "success"); }}>▶ START GAME</button>}
        {gameStatus === "RUNNING" && <button className="btn" style={{ background: "var(--orange)", color: "#0a0a0f", fontSize: 14, padding: "8px 16px" }} onClick={() => { setGameStatus("PAUSED"); pushNotif("Game paused.", "warning"); }}>⏸ PAUSE</button>}
        {gameStatus === "PAUSED" && <button className="btn btn-green" style={{ fontSize: 14, padding: "8px 16px" }} onClick={() => { setGameStatus("RUNNING"); pushNotif("Game resumed.", "success"); }}>▶ RESUME</button>}
        {gameStatus !== "ENDED" && <button className="btn btn-red" style={{ fontSize: 14, padding: "8px 16px" }} onClick={() => { setGameStatus("ENDED"); pushNotif("Game ended.", "warning"); }}>■ END GAME</button>}
        {gameStatus === "ENDED" && <span className="badge badge-muted">GAME OVER</span>}
      </div>

      {/* Admin Tabs */}
      <div style={{ borderBottom: "1px solid var(--border)", display: "flex", padding: "8px 12px 0", background: "#111118" }}>
        {[
          { id: "dashboard", label: "Dashboard" },
          { id: "teams", label: "Teams" },
          { id: "security", label: `Security ${adminAlerts.length > 0 ? `(${adminAlerts.length})` : ""}` },
          { id: "events", label: "Events" },
        ].map((t) => (
          <button key={t.id} className={`tab-btn ${adminTab === t.id ? "active" : ""}`} onClick={() => setAdminTab(t.id)}>{t.label}</button>
        ))}
      </div>

      <div style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
        {/* DASHBOARD */}
        {adminTab === "dashboard" && (
          <div>
            <div className="bebas" style={{ fontSize: 20, marginBottom: 16 }}>LIVE LEADERBOARD</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {leaderboard.map((team, i) => (
                <div key={team.id} className="card">
                  <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                    <div className="bebas" style={{ fontSize: 28, color: ["var(--gold)","#c0c0c0","#cd7f32","var(--muted)"][i], width: 28 }}>{i + 1}</div>
                    <span style={{ fontSize: 20 }}>{team.emoji}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span className="bebas" style={{ fontSize: 18, color: team.accent }}>{team.name}</span>
                        <span className={`badge ${team.eligibility === "ELIGIBLE" ? "badge-green" : "badge-red"}`}>{team.eligibility}</span>
                        <span style={{ fontFamily: "Space Mono", fontSize: 10, color: "var(--muted)" }}>Clue {team.currentClueIndex + 1}/12 · {team.completedCount} done · {team.skippedCount}/5 skips</span>
                      </div>
                    </div>
                    <div className="bebas" style={{ fontSize: 24, color: "var(--gold)" }}>{team.score} pts</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn" style={{ background: "#1a2a1a", color: "var(--green)", border: "1px solid var(--green)44", fontSize: 12, padding: "6px 10px" }} onClick={() => onAdvance(team.id)}>+ADVANCE</button>
                      <button className="btn" style={{ background: "#2a1a1a", color: "var(--red)", border: "1px solid var(--red)44", fontSize: 12, padding: "6px 10px" }} onClick={() => onDeduct(team.id)}>-DEDUCT</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TEAMS DETAIL */}
        {adminTab === "teams" && (
          <div>
            <div className="bebas" style={{ fontSize: 20, marginBottom: 16 }}>TEAM DETAIL</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {teams.map((team) => {
                const ts = teamStates[team.id];
                return (
                  <div key={team.id} className="card" style={{ borderColor: `${team.accent}44` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <span style={{ fontSize: 22 }}>{team.emoji}</span>
                      <div>
                        <div className="bebas" style={{ fontSize: 20, color: team.accent }}>{team.name}</div>
                        <div style={{ fontFamily: "Space Mono", fontSize: 10, color: "var(--muted)" }}>CPT: {team.captain} · PIN: {team.pin}</div>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                      {[
                        { label: "Score", value: ts.score, color: "var(--gold)" },
                        { label: "Clue", value: `${ts.currentClueIndex + 1}/12`, color: "var(--blue)" },
                        { label: "Done", value: ts.completedCount, color: "var(--green)" },
                        { label: "Skips", value: `${ts.skippedCount}/5`, color: "var(--orange)" },
                      ].map((s) => (
                        <div key={s.label} style={{ background: "var(--bg2)", borderRadius: 4, padding: "6px 8px", textAlign: "center" }}>
                          <div className="bebas" style={{ fontSize: 18, color: s.color }}>{s.value}</div>
                          <div style={{ fontFamily: "Space Mono", fontSize: 9, color: "var(--muted)" }}>{s.label}</div>
                        </div>
                      ))}
                    </div>
                    <div>
                      <div style={{ fontFamily: "Space Mono", fontSize: 9, color: "var(--muted)", marginBottom: 6 }}>CLUE PROGRESS</div>
                      <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                        {ts.clueStates.map((cs, i) => (
                          <div key={i} title={`Clue ${i + 1}: ${cs.status}`} style={{ width: 18, height: 18, borderRadius: 3, fontSize: 8, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Space Mono", fontWeight: "bold", background: cs.status === "COMPLETED" ? "var(--green)" : cs.status === "PASSED" ? "var(--orange)" : cs.status === "ACTIVE" ? "var(--blue)" : "var(--bg2)", color: cs.status === "LOCKED" ? "var(--muted)" : "#0a0a0f" }}>
                            {i + 1}
                          </div>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 12, marginTop: 6, fontFamily: "Space Mono", fontSize: 9, color: "var(--muted)" }}>
                        <span style={{ color: "var(--green)" }}>■ done</span>
                        <span style={{ color: "var(--orange)" }}>■ pass</span>
                        <span style={{ color: "var(--blue)" }}>■ active</span>
                        <span>■ locked</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                      <button className="btn btn-ghost" style={{ flex: 1, fontSize: 11, padding: "6px 8px" }} onClick={() => onAdvance(team.id)}>Advance →</button>
                      <button className="btn btn-ghost" style={{ flex: 1, fontSize: 11, padding: "6px 8px", color: "var(--red)", borderColor: "var(--red)44" }} onClick={() => onDeduct(team.id)}>Deduct pts</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* SECURITY */}
        {adminTab === "security" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div className="bebas" style={{ fontSize: 20 }}>SECURITY EVENTS</div>
              {adminAlerts.length > 0 && <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => setAdminAlerts([])}>Clear All</button>}
            </div>
            {adminAlerts.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, fontFamily: "Space Mono", fontSize: 11, color: "var(--muted)" }}>
                🔒 No security events. All clear.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {adminAlerts.map((a) => (
                  <div key={a.id} className={`alert-item alert-${a.type}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ color: a.type === "alert" ? "var(--red)" : "var(--gold)", marginBottom: 2 }}>{a.msg}</div>
                      <div style={{ fontSize: 9, color: "var(--muted)" }}>{a.time}</div>
                    </div>
                    {a.type === "alert" && (
                      <button className="btn btn-red" style={{ fontSize: 11, padding: "4px 10px", marginLeft: 12, flexShrink: 0 }} onClick={() => onDeduct("spades")}>Deduct pts</button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 24 }}>
              <div className="bebas" style={{ fontSize: 16, marginBottom: 10 }}>CLUE MANAGEMENT</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {clues.map((c) => (
                  <div key={c.id} className="card" style={{ padding: "8px 12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <span className="bebas" style={{ fontSize: 13, color: c.required ? "var(--red)" : "var(--text)" }}>{c.id}. {c.title}</span>
                        {c.required && <span className="badge badge-red" style={{ marginLeft: 6, fontSize: 9 }}>REQ</span>}
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn btn-ghost" style={{ fontSize: 10, padding: "3px 8px" }} title="Rotate QR">🔄 QR</button>
                        <button className="btn btn-ghost" style={{ fontSize: 10, padding: "3px 8px", color: "var(--orange)", borderColor: "var(--orange)44" }} title="Reopen clue">🔓 Reopen</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* EVENTS */}
        {adminTab === "events" && (
          <div>
            <div className="bebas" style={{ fontSize: 20, marginBottom: 16 }}>GLOBAL EVENT LOG</div>
            {globalEvents.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, fontFamily: "Space Mono", fontSize: 11, color: "var(--muted)" }}>No events yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {globalEvents.map((e, i) => {
                  const teamColor = e.teamId ? TEAMS.find((t) => t.id === e.teamId)?.accent : "var(--muted)";
                  return (
                    <div key={i} style={{ display: "flex", gap: 10, padding: "6px 10px", background: "var(--bg3)", borderRadius: 4, borderLeft: `2px solid ${e.type === "security" ? "var(--red)" : e.type === "admin" ? "var(--gold)" : teamColor || "var(--border)"}` }}>
                      <div style={{ fontFamily: "Space Mono", fontSize: 10, color: "var(--text)", flex: 1 }}>{e.msg}</div>
                      <div style={{ fontFamily: "Space Mono", fontSize: 9, color: "var(--muted)", whiteSpace: "nowrap" }}>{e.time}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
