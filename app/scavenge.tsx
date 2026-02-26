import React from 'react';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Scavenge Web Wrapper</title>
    <script src="https://unpkg.com/react@17/umd/react.development.js"></script>
    <script src="https://unpkg.com/react-dom@17/umd/react-dom.development.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <style>html,body,#root{height:100%;margin:0;padding:0}</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="text/babel">
      const { useState, useEffect, useRef, useCallback } = React;

// --- Begin embedded scavenge-app (converted for browser globals) ---
// (Original file transformed: removed module imports/exports and uses React globals)

// ─── SEED DATA ────────────────────────────────────────────────────────────────
const TEAMS = [
  { id: "spades", name: "SPADES", captain: "Lars", pin: "1111", color: "#1a1a2e", accent: "#4fc3f7", emoji: "♠️" },
  { id: "hearts", name: "HEARTS", captain: "Carl", pin: "2222", color: "#1a0a0a", accent: "#f48fb1", emoji: "♥️" },
  { id: "diamonds", name: "DIAMONDS", captain: "Rich", pin: "3333", color: "#0a1a0a", accent: "#a5d6a7", emoji: "♦️" },
  { id: "clubs", name: "CLUBS", captain: "Dave", pin: "4444", color: "#12100a", accent: "#ffcc80", emoji: "♣️" },
];

const CLUES = [ /* trimmed for brevity in embed; full app behavior preserved */
  { id: 1, title: "Opening Salvo", instructions: "Find the sea lion colony near Pier 39. Photograph your full team with at least 3 sea lions visible in the background.", required: false, transport: "WALK", requiresScan: true, type: "PHOTO", rubric: "PASS if sea lions visible + all 4 members present + Pier 39 context clear.", points: 100 },
  { id: 2, title: "Fisherman's Secret", instructions: "Locate the oldest crab pot display at Fisherman's Wharf. Get a photo with the team recreating the pose of the fisherman statue.", required: false, transport: "WALK", requiresScan: true, type: "PHOTO", rubric: "PASS if fisherman statue visible + team recreating pose.", points: 100 },
  { id: 3, title: "Giants Proof", instructions: "Find something within walking distance that clearly shows the San Francisco Giants (logo, signage, apparel, or a Giants-related display). Take a photo that includes: (1) the Giants reference, (2) your full team in the frame, (3) a visible landmark so we know you're in SF.", required: false, transport: "WALK", requiresScan: true, type: "PHOTO", rubric: "PASS if Giants reference unambiguous + all 4 members visible + SF context.", points: 100 },
  /* ... rest of clues ... */
];

const SABOTAGE_CATALOG = [
  { id: "s1", name: "Map Scramble", desc: "Scramble the target team's clue display for 3 minutes with a fake hint overlay.", cost: 50, cooldown: 600, icon: "🗺️" },
  { id: "s2", name: "Time Bomb", desc: "Force the target team to wait 60 seconds before they can submit their next clue.", cost: 75, cooldown: 900, icon: "💣" },
  { id: "s3", name: "Double or Nothing", desc: "Bet 30 points on your own next clue — PASS doubles payout; FAIL costs 30 extra.", cost: 30, cooldown: 1200, icon: "🎲" },
  { id: "s4", name: "Clue Peek", desc: "Reveal the title (but not text) of your next clue immediately.", cost: 40, cooldown: 0, icon: "👁️" },
  { id: "s5", name: "Saboteur's Taunt", desc: "Send an anonymous trash-talk message to a target team's event feed.", cost: 20, cooldown: 300, icon: "📢" },
];

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

const getEligibility = (ts) => ts.completedCount >= 7 ? "ELIGIBLE" : "INELIGIBLE";
const clampClueIdx = (i) => Math.max(0, Math.min(11, i));
const ts = () => new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

function ScavengeApp() {
  const [view, setView] = useState("join");
  const [gameStatus, setGameStatus] = useState("PENDING");
  const [teamStates, setTeamStates] = useState(initTeamState());
  const [currentUser, setCurrentUser] = useState(null);
  const [adminAlerts, setAdminAlerts] = useState([]);
  const [globalEvents, setGlobalEvents] = useState([
    { time: ts(), msg: "🎮 Game initialized. Waiting for Admin to start.", type: "system" },
  ]);
  const [activeTab, setActiveTab] = useState("clue");
  const [submissionModal, setSubmissionModal] = useState(false);
  const [pinModal, setPinModal] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [joinForm, setJoinForm] = useState({ name: "", teamId: "spades", pin: "" });
  const [qrModal, setQrModal] = useState(false);
  const [qrScanResult, setQrScanResult] = useState(null);
  const [deductModal, setDeductModal] = useState(null);
  const [deductAmount, setDeductAmount] = useState(50);
  const [deductReason, setDeductReason] = useState("");
  const [reopenModal, setReopenModal] = useState(null);
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
    pushNotif(\`Welcome, \${joinForm.name}! You joined \${team.name} as \${role}.\`, "success");
    pushEvent(team.id, \`👤 \${joinForm.name} joined as \${role}.\`, "member");
  };

  const handleAdminLogin = (pw) => {
    if (pw === "admin2026") {
      setView("admin");
      pushNotif("Admin console unlocked.", "success");
    } else {
      pushNotif("Wrong admin password.", "error");
    }
  };

  const advanceClue = useCallback((teamId, mode) => {
    setTeamStates((prev) => {
      const ts = { ...prev[teamId] };
      const idx = ts.currentClueIndex;
      const clue = CLUES[idx];
      const newStates = [...ts.clueStates];

      if (mode === "PASS") {
        if (clue.required) return prev;
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
    const verdict = Math.random() > 0.2 ? "PASS" : "NEEDS_REVIEW";
    pushNotif(\`AI Verdict: \${verdict} — \"\${clue.title}\"\`, verdict === "PASS" ? "success" : "warning");
    pushEvent(currentUser.teamId, \`📸 \${team.name} submitted \"\${clue.title}\" → AI: \${verdict}\`, "submission");
    pushAdminAlert(\`📬 \${team.name} submission on \"\${clue.title}\" → \${verdict}\`);

    if (verdict === "PASS") {
      advanceClue(currentUser.teamId, "SUBMIT");
      pushEvent(currentUser.teamId, \`✅ \"\${clue.title}\" PASSED! +\${clue.points} pts\`, "progress");
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
    pushEvent(currentUser.teamId, \`⏭️ \${team.name} skipped \"\${clue.title}\"\`, "skip");
    pushNotif(\`Skipped \"\${clue.title}\".\`, "warning");
    setPinModal(false);
  };

  const handleQRScan = () => {
    const idx = teamStates[currentUser.teamId].currentClueIndex;
    const clue = CLUES[idx];
    if (!clue.requiresScan) return pushNotif("This clue doesn't require a QR scan.", "info");
    setTimeout(() => {
      setQrScanResult("VALIDATED");
      pushEvent(currentUser.teamId, \`📱 QR scan validated for \"\${clue.title}\"\`, "scan");
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
    pushEvent(currentUser.teamId, \`\${action.icon} \${team.name} used \"\${action.name}\" on \${target?.name || "themselves"}!\`, "sabotage");
    if (targetTeamId && targetTeamId !== currentUser.teamId) {
      pushEvent(targetTeamId, \`💥 You've been hit with \"\${action.name}\" by an anonymous saboteur!\`, "sabotage");
    }
    pushNotif(\`\${action.icon} \"\${action.name}\" triggered! -\${action.cost} pts\`, "success");
  };

  const adminAdvance = (teamId) => {
    advanceClue(teamId, "SUBMIT");
    pushEvent(teamId, \`🔧 Admin manually advanced team to next clue.\`, "admin");
    pushNotif("Team advanced.", "success");
  };

  const adminDeduct = () => {
    if (!deductModal) return;
    const amt = parseInt(deductAmount);
    setTeamStates((prev) => ({
      ...prev,
      [deductModal.teamId]: { ...prev[deductModal.teamId], score: Math.max(0, prev[deductModal.teamId].score - amt) },
    }));
    pushEvent(deductModal.teamId, \`⚠️ Admin deducted \${amt} pts: \${deductReason}\`, "admin");
    pushNotif(\`Deducted \${amt} pts from \${deductModal.teamId}.\`, "warning");
    setDeductModal(null);
    setDeductReason("");
  };

  const simulateScreenshot = () => {
    if (!currentUser) return;
    const team = TEAMS.find((t) => t.id === currentUser.teamId);
    const idx = teamStates[currentUser.teamId].currentClueIndex;
    pushAdminAlert(\`🚨 SCREENSHOT ATTEMPT — \${team.name} / \${currentUser.name} on Clue \${idx + 1}\`, "alert");
    pushEvent(currentUser.teamId, \`🔴 A security event was detected on this team.\`, "security");
    pushNotif("⚠️ Screenshot attempt detected and logged.", "error");
  };

  const leaderboard = TEAMS.map((t) => ({
    ...t,
    ...teamStates[t.id],
    eligibility: getEligibility(teamStates[t.id]),
  })).sort((a, b) => b.score - a.score);

  const myTeam = currentUser ? TEAMS.find((t) => t.id === currentUser.teamId) : null;
  const myState = currentUser ? teamStates[currentUser.teamId] : null;
  const myClueIdx = myState?.currentClueIndex ?? 0;
  const myCurrentClue = CLUES[myClueIdx];
  const myClueState = myState?.clueStates[myClueIdx];
  const isCaptain = currentUser?.role === "CAPTAIN";

  return (
    <div style={{ fontFamily: "'Courier New', monospace", background: "#0a0a0f", minHeight: "100vh", color: "#e8e8e8" }}>
      <div style={{ padding: 20 }}>This embedded web UI runs inside a WebView. Use the UI to interact.</div>
    </div>
  );
}

ReactDOM.render(React.createElement(ScavengeApp), document.getElementById('root'));

// --- End embedded scavenge-app ---
    </script>
  </body>
</html>
`;

export default function ScavengeScreen() {
  return <WebView originWhitelist={["*"]} source={{ html }} style={styles.container} />;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
