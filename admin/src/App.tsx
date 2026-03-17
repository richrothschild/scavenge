import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { io } from "socket.io-client";
import { derivePaginationState, parseLimitInput, parseOffsetInput } from "./utils/pagination";
import "./App.css";

const TEAM_THEMES = {
  SPADES:   { suit: "♠", accent: "#818cf8", mascot: "⛓️",  fullName: "Alcatraz Aces",        landmark: "Alcatraz Island",   tagline: "Escaped from Alcatraz — and winning this hunt" },
  HEARTS:   { suit: "♥", accent: "#f87171", mascot: "🌉",  fullName: "Golden Gate Hearts",    landmark: "Golden Gate Bridge",tagline: "Crossing the bridge to victory"                 },
  DIAMONDS: { suit: "♦", accent: "#fbbf24", mascot: "🚃",  fullName: "Cable Car Diamonds",    landmark: "SF Cable Cars",     tagline: "All aboard the winning line"                    },
  CLUBS:    { suit: "♣", accent: "#4ade80", mascot: "🌿",  fullName: "Haight Clovers",        landmark: "Haight-Ashbury",    tagline: "Peace, love, and first place"                   },
} as const;
type TeamSuit = keyof typeof TEAM_THEMES;
const TEAM_SUIT_OPTIONS: TeamSuit[] = ["SPADES", "HEARTS", "DIAMONDS", "CLUBS"];

const HELP_ISSUES = [
  { id: "GENERAL", label: "General issue", smsLine: "General support request" },
  { id: "WRONG_CLUE", label: "Wrong clue shown", smsLine: "Wrong clue is showing" },
  { id: "NEEDS_REVIEW", label: "Review delay", smsLine: "Submission is stuck in NEEDS_REVIEW" },
  { id: "APP_STUCK", label: "App stuck", smsLine: "App is frozen or not loading" }
] as const;

type HelpIssueId = typeof HELP_ISSUES[number]["id"];

type Role = "CAPTAIN" | "MEMBER";

const apiBase =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.PROD
    ? "https://scavenge-backend-production.up.railway.app/api"
    : "http://localhost:3001/api");
const socketBase = apiBase.endsWith("/api") ? apiBase.slice(0, -4) : apiBase;
const DICTATOR_PHONE_NUMBER = "4086054832";

const normalizeTeamCodeInput = (value: string) => {
  const normalized = value.trim().toUpperCase();
  return normalized.includes("-") ? (normalized.split("-")[0] ?? normalized) : normalized;
};

type ReviewQueueItem = {
  id: string;
  teamId: string;
  clueIndex: number;
  status: "PENDING" | "RESOLVED";
  createdAt: string;
};

type SecurityEvent = {
  id: string;
  teamId: string;
  participantName?: string;
  type: "SCREENSHOT_ATTEMPT" | "OTHER";
  timestamp: string;
  clueIndex: number;
  deviceInfo?: string;
};

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

type GameStatus = "PENDING" | "RUNNING" | "PAUSED" | "ENDED";

type GameStatusPayload = {
  status: GameStatus;
  name: string;
  timezone: string;
  start_time?: string;
};

type RealtimeEventItem = {
  id: string;
  timestamp: string;
  event: string;
  message: string;
};

type AdminClueSource = "test" | "production";

type SeedResetResponse = {
  variant: AdminClueSource;
  resolvedSource: AdminClueSource | "default";
  clueCount: number;
  requiresRestart: boolean;
};

function App() {
  const isAdminPath = window.location.pathname.startsWith("/admin");
  const [mode] = useState<"player" | "admin">(isAdminPath ? "admin" : "player");
  const [adminView, setAdminView] = useState<"setup" | "live-ops">("live-ops");
  const [joinCode, setJoinCode] = useState("SPADES");
  const [displayName, setDisplayName] = useState("");
  const [captainPin, setCaptainPin] = useState("");
  const [joinOptions, setJoinOptions] = useState<JoinTeamOption[]>([]);
  const [authToken, setAuthToken] = useState("");
  const [role, setRole] = useState<Role | null>(null);
  const [teamId, setTeamId] = useState("");
  const [teamState, setTeamState] = useState<any>(null);
  const [submitText, setSubmitText] = useState("");
  const [lastVerdict, setLastVerdict] = useState<"PASS" | "FAIL" | "NEEDS_REVIEW" | null>(null);
  const [lastFeedback, setLastFeedback] = useState("");
  const [adminHint, setAdminHint] = useState<{ clueIndex: number; hintText: string } | null>(null);
  const [broadcastMsg, setBroadcastMsg] = useState<string | null>(null);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminToken, setAdminToken] = useState("");
  const [reviewQueue, setReviewQueue] = useState<ReviewQueueItem[]>([]);
  const [reviewQueueTotal, setReviewQueueTotal] = useState(0);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const [securityEventsTotal, setSecurityEventsTotal] = useState(0);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditLogsTotal, setAuditLogsTotal] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardTeam[]>([]);
  const [deductTeamId, setDeductTeamId] = useState("");
  const [deductAmount, setDeductAmount] = useState("10");
  const [deductReason, setDeductReason] = useState("Screenshot violation");
  const [reopenTeamId, setReopenTeamId] = useState("");
  const [reopenClueIndex, setReopenClueIndex] = useState("0");
  const [reopenDurationSeconds, setReopenDurationSeconds] = useState("300");
  const [reopenReason, setReopenReason] = useState("Manual review window");
  const [gameStatus, setGameStatus] = useState<GameStatusPayload | null>(null);
  const [reviewPassPointsOverride, setReviewPassPointsOverride] = useState("");
  const [liveOpsAutoRefreshEnabled, setLiveOpsAutoRefreshEnabled] = useState(false);
  const [liveOpsPollSeconds, setLiveOpsPollSeconds] = useState("10");
  const [realtimeEnabled, setRealtimeEnabled] = useState(true);
  const [reviewQueueLimit, setReviewQueueLimit] = useState("50");
  const [reviewQueueOffset, setReviewQueueOffset] = useState("0");
  const [reviewTeamFilter, setReviewTeamFilter] = useState("");
  const [scopeSecurityToReviewTeam, setScopeSecurityToReviewTeam] = useState(true);
  const [securityEventsLimit, setSecurityEventsLimit] = useState("50");
  const [securityEventsOffset, setSecurityEventsOffset] = useState("0");
  const [auditLogsLimit, setAuditLogsLimit] = useState("100");
  const [auditLogsOffset, setAuditLogsOffset] = useState("0");
  const [auditActionFilter, setAuditActionFilter] = useState("");
  const [auditTeamFilter, setAuditTeamFilter] = useState("");
  const [realtimeEvents, setRealtimeEvents] = useState<RealtimeEventItem[]>([]);
  const [statusMessage, setStatusMessage] = useState("Ready");
  // ── Player UI state ───────────────────────────────────────────
  const [playerTab, setPlayerTab] = useState<"clue" | "leaderboard">("clue");
  const [infoModal, setInfoModal] = useState<"howtoplay" | "rules" | "help" | null>(null);
  const [selectedHelpIssueId, setSelectedHelpIssueId] = useState<HelpIssueId>("GENERAL");
  const [submitFile, setSubmitFile] = useState<File | null>(null);
  const [submitPreviewUrl, setSubmitPreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [countdown, setCountdown] = useState("");
  const [socketConnected, setSocketConnected] = useState(true);
  // ── Sabotage store ────────────────────────────────────────────
  const [sabotageCatalog, setSabotageCatalog] = useState<any[]>([]);
  const [sabotageTab, setSabotageTab] = useState(false);
  const [sabotageAction, setSabotageAction] = useState("");
  const [sabotageTarget, setSabotageTarget] = useState("");
  const [adminClueUploadSource, setAdminClueUploadSource] = useState<AdminClueSource>("production");
  const [adminClueUploadFile, setAdminClueUploadFile] = useState<File | null>(null);
  const [adminClueUploadBusy, setAdminClueUploadBusy] = useState(false);
  const [adminStartTestBusy, setAdminStartTestBusy] = useState(false);
  const [teamAssignments, setTeamAssignments] = useState<JoinTeamOption[]>([]);
  const [assignmentTeamId, setAssignmentTeamId] = useState("spades");
  const [assignmentName, setAssignmentName] = useState("");
  // ── Verdict reveal overlay ────────────────────────────────────
  const [verdictReveal, setVerdictReveal] = useState<"PASS" | "FAIL" | "NEEDS_REVIEW" | null>(null);
  // ── Welcome screen ────────────────────────────────────────────
  const [showWelcome, setShowWelcome] = useState(false);
  // ── Clue reveal gate (shows tap-to-reveal on each new clue) ──
  const [revealedClueIndex, setRevealedClueIndex] = useState<number | null>(null);
  // ── Toast notifications ───────────────────────────────────────
  const [toasts, setToasts] = useState<Array<{ id: string; type: "success" | "error" | "info"; msg: string }>>([]);
  // ── Clue elapsed timer ────────────────────────────────────────
  const [clueElapsed, setClueElapsed] = useState("");

  const headers = useMemo(
    () => ({ "Content-Type": "application/json", "x-auth-token": authToken }),
    [authToken]
  );

  const getPlayerHeaders = (tokenOverride?: string) => ({
    "Content-Type": "application/json",
    "x-auth-token": tokenOverride ?? authToken
  });

  const getAdminHeaders = (tokenOverride?: string) => ({
    "Content-Type": "application/json",
    "x-admin-token": tokenOverride ?? adminToken
  });

  const adminHeaders = useMemo(
    () => ({ "Content-Type": "application/json", "x-admin-token": adminToken }),
    [adminToken]
  );

  const filteredAuditLogs = useMemo(() => {
    const actionNeedle = auditActionFilter.trim().toLowerCase();
    const teamNeedle = auditTeamFilter.trim().toLowerCase();

    return auditLogs.filter((item) => {
      const actionValue = String(item?.action ?? "").toLowerCase();
      const targetValue = String(item?.targetId ?? "").toLowerCase();
      const actionMatch = !actionNeedle || actionValue.includes(actionNeedle);
      const teamMatch = !teamNeedle || targetValue.includes(teamNeedle);
      return actionMatch && teamMatch;
    });
  }, [auditActionFilter, auditLogs, auditTeamFilter]);

  const filteredReviewQueue = useMemo(() => {
    const teamNeedle = reviewTeamFilter.trim().toLowerCase();
    if (!teamNeedle) {
      return reviewQueue;
    }

    return reviewQueue.filter((item) => item.teamId.toLowerCase().includes(teamNeedle));
  }, [reviewQueue, reviewTeamFilter]);

  const filteredSecurityEvents = useMemo(() => {
    if (!scopeSecurityToReviewTeam) {
      return securityEvents;
    }

    const teamNeedle = reviewTeamFilter.trim().toLowerCase();
    if (!teamNeedle) {
      return securityEvents;
    }

    return securityEvents.filter((item) => item.teamId.toLowerCase().includes(teamNeedle));
  }, [reviewTeamFilter, scopeSecurityToReviewTeam, securityEvents]);

  const reviewQueuePagination = useMemo(() => {
    const limit = parseLimitInput(reviewQueueLimit, 50);
    const offset = parseOffsetInput(reviewQueueOffset);
    return derivePaginationState(offset, limit, reviewQueueTotal);
  }, [reviewQueueLimit, reviewQueueOffset, reviewQueueTotal]);

  const securityEventsPagination = useMemo(() => {
    const limit = parseLimitInput(securityEventsLimit, 50);
    const offset = parseOffsetInput(securityEventsOffset);
    return derivePaginationState(offset, limit, securityEventsTotal);
  }, [securityEventsLimit, securityEventsOffset, securityEventsTotal]);

  const auditLogsPagination = useMemo(() => {
    const limit = parseLimitInput(auditLogsLimit, 100);
    const offset = parseOffsetInput(auditLogsOffset);
    return derivePaginationState(offset, limit, auditLogsTotal);
  }, [auditLogsLimit, auditLogsOffset, auditLogsTotal]);

  const parseError = async (response: Response, fallback: string) => {
    let rawBody = "";
    try {
      rawBody = await response.text();
    } catch {
      return `${fallback} (HTTP ${response.status})`;
    }

    if (!rawBody.trim()) {
      return `${fallback} (HTTP ${response.status})`;
    }

    try {
      const payload = JSON.parse(rawBody) as { error?: string };
      if (typeof payload.error === "string" && payload.error.trim()) {
        return payload.error;
      }
    } catch {
      // Non-JSON responses are surfaced as plain text for better diagnostics.
    }

    return rawBody.length > 240 ? `${fallback} (HTTP ${response.status})` : rawBody;
  };

  const formatNetworkError = (action: string, endpoint: string, error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    return `${action} failed at ${endpoint}. Reason: ${reason}. Check API URL and CORS allow-list.`;
  };

  const appendRealtimeEvent = (event: string, message: string) => {
    const item: RealtimeEventItem = {
      id: `${Date.now()}-${Math.random()}`,
      timestamp: new Date().toISOString(),
      event,
      message
    };
    setRealtimeEvents((previous) => [item, ...previous].slice(0, 30));
  };

  const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

  const waitForApiReady = async () => {
    const endpoint = `${apiBase}/health`;
    let lastError = "Backend did not become healthy in time.";

    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        if (response.ok) {
          const payload = await response.json() as { ok?: boolean };
          if (payload.ok) {
            return;
          }
          lastError = "Health endpoint responded without ok=true.";
        } else {
          lastError = `Health check returned HTTP ${response.status}.`;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }

      await delay(2000);
    }

    throw new Error(lastError);
  };

  const haptic = (pattern: number | number[] = 50) => {
    if ("vibrate" in navigator) navigator.vibrate(pattern);
  };

  const addToast = (type: "success" | "error" | "info", msg: string) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts(prev => [...prev, { id, type, msg }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  };

  const getTeamTheme = () => {
    const src = (teamState?.teamName ?? joinCode ?? "").toUpperCase();
    for (const key of Object.keys(TEAM_THEMES) as TeamSuit[]) {
      if (src.includes(key)) return { ...TEAM_THEMES[key], key };
    }
    return null;
  };

  const selectedHelpIssue = useMemo(
    () => HELP_ISSUES.find((issue) => issue.id === selectedHelpIssueId) ?? HELP_ISSUES[0],
    [selectedHelpIssueId]
  );

  const selectedJoinTeam = useMemo(
    () => joinOptions.find((team) => team.teamName === normalizeTeamCodeInput(joinCode)),
    [joinCode, joinOptions]
  );

  const selectedJoinParticipants = selectedJoinTeam?.assignedParticipants ?? [];

  const buildDictatorSmsBody = (isTest: boolean) => {
    const teamName = normalizeTeamCodeInput(teamState?.teamName ?? joinCode) || "UNKNOWN";
    const clueNumber = (teamState?.currentClueIndex ?? 0) + 1;

    if (isTest) {
      return `SCAVENGE TEST\nTeam: ${teamName}\nClue: ${clueNumber}\nTopic: ${selectedHelpIssue.smsLine}\nPlease ignore - this is a test text from the Help screen.`;
    }

    return `SCAVENGE HELP REQUEST\nTeam: ${teamName}\nClue: ${clueNumber}\nIssue: ${selectedHelpIssue.smsLine}`;
  };

  const buildDictatorSmsHref = (isTest: boolean) => {
    const body = buildDictatorSmsBody(isTest);
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    return `sms:${DICTATOR_PHONE_NUMBER}${isIos ? "&" : "?"}body=${encodeURIComponent(body)}`;
  };

  const handleDictatorClick = async (isTest: boolean) => {
    const body = buildDictatorSmsBody(isTest);

    try {
      const isDesktop = !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isDesktop && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(`To: ${DICTATOR_PHONE_NUMBER}\n\n${body}`);
        addToast("info", "Copied phone number + message to clipboard for desktop texting.");
      }

      setStatusMessage(isTest ? "Opening test text composer for the Dictator." : "Opening help text composer for the Dictator.");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setStatusMessage(`Unable to open text composer: ${reason}`);
      addToast("error", "Could not open texting app. Please contact the Dictator manually.");
    }
  };

  const joinTeam = async (event: FormEvent) => {
    event.preventDefault();
    const endpoint = `${apiBase}/auth/join`;
    let response: Response;

    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          joinCode: normalizeTeamCodeInput(joinCode),
          displayName: displayName.trim(),
          captainPin: captainPin.trim() ? captainPin : undefined
        })
      });
    } catch (error) {
      setStatusMessage(formatNetworkError("Join", endpoint, error));
      return;
    }

    if (!response.ok) {
      setStatusMessage(await parseError(response, "Join failed"));
      return;
    }

    const payload = await response.json();
    setAuthToken(payload.session.token);
    setRole(payload.session.role);
    setTeamId(payload.session.teamId);
    setLastVerdict(null);
    setLastFeedback("");
    setShowWelcome(true);
    void fetchGameStatus();
    await refreshTeamState(payload.session.token);
    setStatusMessage(`Joined as ${payload.session.role}`);
  };

  const fetchJoinOptions = async () => {
    const endpoint = `${apiBase}/join/options`;
    let response: Response;
    try {
      response = await fetch(endpoint);
    } catch (error) {
      setStatusMessage(formatNetworkError("Join options fetch", endpoint, error));
      return;
    }

    if (!response.ok) {
      setStatusMessage(await parseError(response, "Join options fetch failed"));
      return;
    }

    const payload = await response.json();
    setJoinOptions(payload.teams || []);
  };

  const fetchTeamAssignments = async () => {
    const response = await fetch(`${apiBase}/admin/team-assignments`, { headers: adminHeaders });
    const payload = await response.json();
    if (!response.ok) {
      setStatusMessage(payload.error || "Team assignment fetch failed");
      return;
    }
    setTeamAssignments(payload.teams || []);
  };

  const assignParticipantToTeam = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = assignmentName.trim();
    if (!trimmedName) {
      setStatusMessage("Participant name is required");
      return;
    }

    const response = await fetch(`${apiBase}/admin/team-assignments/assign`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ teamId: assignmentTeamId, participantName: trimmedName })
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatusMessage(payload.error || "Team assignment failed");
      return;
    }

    setAssignmentName("");
    setStatusMessage(
      payload.movedFromTeamId
        ? `Moved ${payload.participantName} from ${payload.movedFromTeamId} to ${payload.teamId}`
        : `Assigned ${payload.participantName} to ${payload.teamId}`
    );
    await Promise.all([fetchTeamAssignments(), fetchAuditLogs()]);
  };

  const removeParticipantFromTeam = async (teamId: string, participantName: string) => {
    const response = await fetch(`${apiBase}/admin/team-assignments/remove`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ teamId, participantName })
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatusMessage(payload.error || "Participant removal failed");
      return;
    }

    setStatusMessage(`Removed ${payload.participantName} from ${payload.teamId}`);
    await Promise.all([fetchTeamAssignments(), fetchAuditLogs()]);
  };

  const refreshTeamState = async (tokenOverride?: string) => {
    const effectiveToken = tokenOverride ?? authToken;
    if (!effectiveToken) return;
    const response = await fetch(`${apiBase}/team/me/state`, { headers: getPlayerHeaders(effectiveToken) });
    const payload = await response.json();
    if (!response.ok) {
      setStatusMessage(payload.error || "Unable to fetch team state");
      return;
    }
    setTeamState(payload);
  };

  const submitClue = async () => {
    setIsSubmitting(true);
    try {
      let mediaData: string | undefined;
      if (submitFile) {
        mediaData = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(submitFile);
        });
      }

      const response = await fetch(`${apiBase}/team/me/submit`, {
        method: "POST",
        headers,
        body: JSON.stringify({ textContent: submitText, mediaData })
      });
      const payload = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error || "Submit failed");
        return;
      }

      const verdict = payload.verdict as "PASS" | "FAIL" | "NEEDS_REVIEW";
      setLastVerdict(verdict);
      const reasons = Array.isArray(payload?.ai?.reasons) ? payload.ai.reasons.join("; ") : "";
      setLastFeedback(reasons || `Submission verdict: ${verdict}`);
      setStatusMessage(`Submission verdict: ${verdict}`);
      // Verdict reveal + haptic + toast
      setVerdictReveal(verdict);
      haptic(verdict === "PASS" ? [100, 50, 150] : verdict === "FAIL" ? [200] : [50]);
      addToast(
        verdict === "PASS" ? "success" : verdict === "FAIL" ? "error" : "info",
        verdict === "PASS" ? "Correct! Moving to next clue." : verdict === "FAIL" ? "Not quite — check the feedback." : "Submitted for admin review."
      );
      setTimeout(() => setVerdictReveal(null), verdict === "PASS" ? 3200 : 2500);
      if (verdict === "PASS") {
        setSubmitText("");
        setSubmitFile(null);
        setSubmitPreviewUrl(null);
      }
      await refreshTeamState();
    } finally {
      setIsSubmitting(false);
    }
  };

  const passClue = async () => {
    const response = await fetch(`${apiBase}/team/me/pass`, {
      method: "POST",
      headers
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatusMessage(payload.error || "Pass failed");
      return;
    }

    setLastVerdict("PASS");
    setLastFeedback("Clue skipped by captain. You can now request the next clue.");
    setStatusMessage("Clue passed");
    await refreshTeamState();
  };




  const fetchSabotageCatalog = async () => {
    const response = await fetch(`${apiBase}/sabotage/catalog`, { headers });
    const payload = await response.json();
    if (response.ok) setSabotageCatalog(payload.items || []);
  };

  const uploadAdminCluesFile = async (event: FormEvent) => {
    event.preventDefault();
    if (!adminClueUploadFile) {
      setStatusMessage("Select a JSON file to upload.");
      return;
    }

    setAdminClueUploadBusy(true);
    try {
      let seedConfigPayload: unknown;
      try {
        const text = await adminClueUploadFile.text();
        seedConfigPayload = JSON.parse(text);
      } catch {
        setStatusMessage("Invalid JSON file. Please upload a valid seed config JSON.");
        return;
      }

      const response = await fetch(`${apiBase}/admin/clues/upload`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ source: adminClueUploadSource, seedConfig: seedConfigPayload })
      });
      const payload = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error || "Failed to upload clue file.");
        return;
      }

      setStatusMessage(`Uploaded ${adminClueUploadSource} clue file with ${payload.clueCount} clues.`);
    } finally {
      setAdminClueUploadBusy(false);
    }
  };

  const downloadAdminClueTemplate = async (source: AdminClueSource) => {
    const response = await fetch(`${apiBase}/admin/clues/template?source=${source}`, { headers: adminHeaders });
    const payload = await response.json();
    if (!response.ok) {
      setStatusMessage(payload.error || "Failed to download clue template.");
      return;
    }

    const templateJson = `${JSON.stringify(payload.seedConfig, null, 2)}\n`;
    const blob = new Blob([templateJson], { type: "application/json" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `seed-config.${source}.template.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);

    if (payload.fallbackToDefault) {
      setStatusMessage(`Downloaded ${source} template from default seed-config.json (missing ${source} variant file).`);
      return;
    }

    setStatusMessage(`Downloaded ${source} clue template.`);
  };

  const triggerSabotage = async (actionId: string, targetTeamId: string) => {
    const response = await fetch(`${apiBase}/team/me/sabotage`, {
      method: "POST",
      headers,
      body: JSON.stringify({ actionId, targetTeamId: targetTeamId || undefined })
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatusMessage(payload.error || "Sabotage failed");
      return;
    }
    setStatusMessage("Sabotage triggered!");
    await refreshTeamState();
  };

  const adminLogin = async (event: FormEvent) => {
    event.preventDefault();
    const response = await fetch(`${apiBase}/auth/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: adminPassword })
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatusMessage(payload.error || "Admin login failed");
      return;
    }
    setAdminToken(payload.token);
    setStatusMessage("Admin logged in");
  };

  const fetchReviewQueue = async (pagination?: { limit?: number; offset?: number }) => {
    const limit = typeof pagination?.limit === "number" ? pagination.limit : parseLimitInput(reviewQueueLimit, 50);
    const offset = typeof pagination?.offset === "number" ? pagination.offset : parseOffsetInput(reviewQueueOffset);
    const response = await fetch(`${apiBase}/admin/review-queue?limit=${limit}&offset=${offset}`, { headers: adminHeaders });
    const payload = await response.json();
    if (!response.ok) return setStatusMessage(payload.error || "Review queue failed");
    setReviewQueue(payload.items || []);
    setReviewQueueTotal(typeof payload.total === "number" ? payload.total : (payload.items || []).length);
    setReviewQueueLimit(String(limit));
    setReviewQueueOffset(String(offset));
  };

  const resolveReview = async (reviewId: string, verdict: "PASS" | "FAIL", pointsAwarded?: number) => {
    const body: { verdict: "PASS" | "FAIL"; pointsAwarded?: number } = { verdict };
    if (verdict === "PASS" && typeof pointsAwarded === "number") {
      body.pointsAwarded = pointsAwarded;
    }

    const response = await fetch(`${apiBase}/admin/review/${reviewId}/resolve`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify(body)
    });
    const payload = await response.json();
    setStatusMessage(response.ok ? `Review resolved: ${payload.verdict}` : payload.error || "Resolve failed");
    await fetchReviewQueue();
  };

  const fetchGameStatus = async () => {
    const endpoint = `${apiBase}/game/status`;
    let response: Response;
    try {
      response = await fetch(endpoint);
    } catch (error) {
      setStatusMessage(formatNetworkError("Game status fetch", endpoint, error));
      return;
    }

    if (!response.ok) {
      setStatusMessage(await parseError(response, "Game status fetch failed"));
      return;
    }

    const payload = await response.json();
    setGameStatus(payload);
  };

  const updateGameStatus = async (status: GameStatus) => {
    const response = await fetch(`${apiBase}/game/status`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ status })
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatusMessage(payload.error || "Game status update failed");
      return;
    }
    setGameStatus(payload);
    setStatusMessage(`Game status set to ${payload.status}`);
  };

  const startTestHunt = async () => {
    if (!adminToken) {
      setStatusMessage("Admin login required");
      return;
    }

    const confirmed = window.confirm(
      "Reset to the TEST hunt, restart the backend, and start the game now? This wipes current progress."
    );
    if (!confirmed) {
      return;
    }

    setAdminStartTestBusy(true);

    try {
      let activeAdminToken = adminToken;

      setStatusMessage("Resetting to TEST hunt…");
      const resetResponse = await fetch(`${apiBase}/admin/reset-seed`, {
        method: "POST",
        headers: getAdminHeaders(activeAdminToken),
        body: JSON.stringify({ variant: "test" })
      });

      if (!resetResponse.ok) {
        setStatusMessage(await parseError(resetResponse, "Test hunt reset failed"));
        return;
      }

      const resetPayload = await resetResponse.json() as SeedResetResponse;

      if (resetPayload.requiresRestart) {
        setStatusMessage("Test hunt loaded. Restarting backend…");
        try {
          await fetch(`${apiBase}/admin/restart`, {
            method: "POST",
            headers: adminHeaders
          });
        } catch {
          // Expected when the server exits before the response fully settles.
        }

        setStatusMessage("Waiting for backend to come back…");
        await waitForApiReady();

        setStatusMessage("Backend is up. Re-authenticating admin session…");
        const reloginResponse = await fetch(`${apiBase}/auth/admin/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: adminPassword })
        });

        if (!reloginResponse.ok) {
          setStatusMessage(await parseError(reloginResponse, "Admin re-login failed after restart"));
          return;
        }

        const reloginPayload = await reloginResponse.json() as { token: string };
        activeAdminToken = reloginPayload.token;
        setAdminToken(reloginPayload.token);
      }

      setStatusMessage("Backend is up. Starting TEST hunt…");
      const statusResponse = await fetch(`${apiBase}/game/status`, {
        method: "POST",
        headers: getAdminHeaders(activeAdminToken),
        body: JSON.stringify({ status: "RUNNING" })
      });

      if (!statusResponse.ok) {
        setStatusMessage(await parseError(statusResponse, "Test hunt start failed"));
        return;
      }

      const statusPayload = await statusResponse.json() as GameStatusPayload;
      setGameStatus(statusPayload);
      await Promise.all([fetchLeaderboard(), fetchTeamAssignments(), fetchAuditLogs(), fetchReviewQueue(), fetchSecurityEvents()]);
      setStatusMessage(`TEST hunt started with ${resetPayload.clueCount} clues (${resetPayload.resolvedSource} source).`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setStatusMessage(`Start TEST hunt failed: ${reason}`);
    } finally {
      setAdminStartTestBusy(false);
    }
  };

  const fetchSecurityEvents = async (pagination?: { limit?: number; offset?: number }) => {
    const limit = typeof pagination?.limit === "number" ? pagination.limit : parseLimitInput(securityEventsLimit, 50);
    const offset = typeof pagination?.offset === "number" ? pagination.offset : parseOffsetInput(securityEventsOffset);
    const response = await fetch(`${apiBase}/admin/security-events?limit=${limit}&offset=${offset}`, { headers: adminHeaders });
    const payload = await response.json();
    if (!response.ok) return setStatusMessage(payload.error || "Security fetch failed");
    setSecurityEvents(payload.items || []);
    setSecurityEventsTotal(typeof payload.total === "number" ? payload.total : (payload.items || []).length);
    setSecurityEventsLimit(String(limit));
    setSecurityEventsOffset(String(offset));
  };

  const fetchLeaderboard = async () => {
    const endpoint = `${apiBase}/leaderboard`;
    let response: Response;
    try {
      response = await fetch(endpoint);
    } catch (error) {
      setStatusMessage(formatNetworkError("Leaderboard fetch", endpoint, error));
      return;
    }

    if (!response.ok) {
      setStatusMessage(await parseError(response, "Leaderboard fetch failed"));
      return;
    }

    const payload = await response.json();
    setLeaderboard(payload.teams || []);
  };

  const fetchAuditLogs = async (pagination?: { limit?: number; offset?: number }) => {
    const limit = typeof pagination?.limit === "number" ? pagination.limit : parseLimitInput(auditLogsLimit, 100);
    const offset = typeof pagination?.offset === "number" ? pagination.offset : parseOffsetInput(auditLogsOffset);
    const response = await fetch(`${apiBase}/admin/audit-logs?limit=${limit}&offset=${offset}`, { headers: adminHeaders });
    const payload = await response.json();
    if (!response.ok) return setStatusMessage(payload.error || "Audit fetch failed");
    setAuditLogs(payload.items || []);
    setAuditLogsTotal(typeof payload.total === "number" ? payload.total : (payload.items || []).length);
    setAuditLogsLimit(String(limit));
    setAuditLogsOffset(String(offset));
  };

  const prevReviewQueuePage = async () => {
    const limit = parseLimitInput(reviewQueueLimit, 50);
    const offset = parseOffsetInput(reviewQueueOffset);
    const nextOffset = Math.max(0, offset - limit);
    await fetchReviewQueue({ limit, offset: nextOffset });
  };

  const firstReviewQueuePage = async () => {
    const limit = parseLimitInput(reviewQueueLimit, 50);
    await fetchReviewQueue({ limit, offset: 0 });
  };

  const nextReviewQueuePage = async () => {
    const limit = parseLimitInput(reviewQueueLimit, 50);
    const offset = parseOffsetInput(reviewQueueOffset);
    const nextOffset = offset + limit;
    if (nextOffset >= reviewQueueTotal) {
      setStatusMessage("Review queue already at last page");
      return;
    }
    await fetchReviewQueue({ limit, offset: nextOffset });
  };

  const lastReviewQueuePage = async () => {
    const limit = parseLimitInput(reviewQueueLimit, 50);
    const lastOffset = reviewQueueTotal <= 0 ? 0 : Math.floor((reviewQueueTotal - 1) / limit) * limit;
    await fetchReviewQueue({ limit, offset: lastOffset });
  };

  const prevSecurityEventsPage = async () => {
    const limit = parseLimitInput(securityEventsLimit, 50);
    const offset = parseOffsetInput(securityEventsOffset);
    const nextOffset = Math.max(0, offset - limit);
    await fetchSecurityEvents({ limit, offset: nextOffset });
  };

  const firstSecurityEventsPage = async () => {
    const limit = parseLimitInput(securityEventsLimit, 50);
    await fetchSecurityEvents({ limit, offset: 0 });
  };

  const nextSecurityEventsPage = async () => {
    const limit = parseLimitInput(securityEventsLimit, 50);
    const offset = parseOffsetInput(securityEventsOffset);
    const nextOffset = offset + limit;
    if (nextOffset >= securityEventsTotal) {
      setStatusMessage("Security events already at last page");
      return;
    }
    await fetchSecurityEvents({ limit, offset: nextOffset });
  };

  const lastSecurityEventsPage = async () => {
    const limit = parseLimitInput(securityEventsLimit, 50);
    const lastOffset = securityEventsTotal <= 0 ? 0 : Math.floor((securityEventsTotal - 1) / limit) * limit;
    await fetchSecurityEvents({ limit, offset: lastOffset });
  };

  const prevAuditLogsPage = async () => {
    const limit = parseLimitInput(auditLogsLimit, 100);
    const offset = parseOffsetInput(auditLogsOffset);
    const nextOffset = Math.max(0, offset - limit);
    await fetchAuditLogs({ limit, offset: nextOffset });
  };

  const firstAuditLogsPage = async () => {
    const limit = parseLimitInput(auditLogsLimit, 100);
    await fetchAuditLogs({ limit, offset: 0 });
  };

  const nextAuditLogsPage = async () => {
    const limit = parseLimitInput(auditLogsLimit, 100);
    const offset = parseOffsetInput(auditLogsOffset);
    const nextOffset = offset + limit;
    if (nextOffset >= auditLogsTotal) {
      setStatusMessage("Audit logs already at last page");
      return;
    }
    await fetchAuditLogs({ limit, offset: nextOffset });
  };

  const lastAuditLogsPage = async () => {
    const limit = parseLimitInput(auditLogsLimit, 100);
    const lastOffset = auditLogsTotal <= 0 ? 0 : Math.floor((auditLogsTotal - 1) / limit) * limit;
    await fetchAuditLogs({ limit, offset: lastOffset });
  };

  const loadAdminDashboard = async () => {
    await Promise.all([fetchReviewQueue(), fetchSecurityEvents(), fetchAuditLogs(), fetchLeaderboard(), fetchGameStatus()]);
    setStatusMessage("Admin dashboard refreshed");
  };

  useEffect(() => {
    if (mode !== "admin" || adminView !== "live-ops" || !adminToken || !liveOpsAutoRefreshEnabled) {
      return;
    }

    const parsed = Number(liveOpsPollSeconds);
    const intervalMs = Number.isFinite(parsed) && parsed >= 3 ? parsed * 1000 : 10000;

    const id = window.setInterval(() => {
      void loadAdminDashboard();
    }, intervalMs);

    return () => window.clearInterval(id);
  }, [adminToken, adminView, liveOpsAutoRefreshEnabled, liveOpsPollSeconds, mode]);

  useEffect(() => {
    if (mode !== "admin" || !adminToken || !realtimeEnabled) {
      return;
    }

    const socket = io(socketBase, {
      transports: ["websocket"],
      withCredentials: true
    });

    socket.on("connect", () => {
      setStatusMessage("Realtime connected");
      appendRealtimeEvent("connect", "Realtime socket connected");
    });

    socket.on("game:status_changed", () => {
      void fetchGameStatus();
      setStatusMessage("Realtime: game status changed");
      appendRealtimeEvent("game:status_changed", "Game status changed");
    });

    socket.on("security:screenshot_alert", () => {
      if (adminView === "live-ops") {
        void fetchSecurityEvents();
      }
      setStatusMessage("Realtime: security alert received");
      appendRealtimeEvent("security:screenshot_alert", "Security screenshot alert received");
    });

    socket.on("submission:needs_review", () => {
      if (adminView === "live-ops") {
        void fetchReviewQueue();
      }
      setStatusMessage("Realtime: submission needs review");
      appendRealtimeEvent("submission:needs_review", "Submission queued for admin review");
    });

    socket.on("leaderboard:updated", () => {
      if (adminView === "live-ops") {
        void fetchLeaderboard();
      }
      setStatusMessage("Realtime: leaderboard updated");
      appendRealtimeEvent("leaderboard:updated", "Leaderboard updated");
    });

    socket.on("admin:qr_rotated", () => {
      void fetchAuditLogs();
      setStatusMessage("Realtime: QR rotated");
      appendRealtimeEvent("admin:qr_rotated", "QR public id rotated");
    });

    socket.on("disconnect", () => {
      appendRealtimeEvent("disconnect", "Realtime socket disconnected");
    });

    return () => {
      socket.disconnect();
    };
  }, [adminToken, adminView, mode, realtimeEnabled]);

  // ── Player: fetch game status + leaderboard on mount ─────────
  useEffect(() => {
    if (mode !== "player") return;
    void fetchJoinOptions();
    void fetchGameStatus();
    void fetchLeaderboard();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (!displayName) return;
    if (selectedJoinParticipants.includes(displayName)) return;
    setDisplayName("");
  }, [displayName, selectedJoinParticipants]);

  useEffect(() => {
    if (mode !== "admin" || !adminToken || adminView !== "setup") return;
    void fetchTeamAssignments();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken, adminView, mode]);

  // ── Player: countdown timer ───────────────────────────────────
  useEffect(() => {
    if (mode !== "player") return;
    const getStartMs = () =>
      gameStatus?.start_time
        ? new Date(gameStatus.start_time).getTime()
        : new Date("2026-04-11T17:00:00.000Z").getTime(); // 10 AM PT fallback

    const tick = () => {
      const diff = getStartMs() - Date.now();
      if (diff <= 0) { setCountdown(""); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdown(`${d}d ${h}h ${m}m ${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [mode, gameStatus]);

  // ── Player: real-time socket ──────────────────────────────────
  useEffect(() => {
    if (mode !== "player" || !authToken) return;
    const sock = io(socketBase, { transports: ["websocket"], withCredentials: true });
    sock.on("connect", () => setSocketConnected(true));
    sock.on("disconnect", () => setSocketConnected(false));
    sock.on("connect_error", () => setSocketConnected(false));
    sock.on("team:clue_advanced", () => {
      void refreshTeamState();
      void fetchLeaderboard();
    });
    sock.on("game:status_changed", () => { void fetchGameStatus(); void refreshTeamState(); });
    sock.on("leaderboard:updated", () => { void fetchLeaderboard(); });
    sock.on("submission:verdict_ready", () => { void refreshTeamState(); });
    sock.on("sabotage:triggered", () => { void refreshTeamState(); });
    sock.on("admin:hint", (data: { clueIndex: number; hintText: string }) => { setAdminHint(data); });
    sock.on("admin:broadcast", (data: { message: string }) => { setBroadcastMsg(data.message); setTimeout(() => setBroadcastMsg(null), 8000); });
    return () => { sock.disconnect(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, mode]);

  // ── Player: auto-refresh every 30s while in game ─────────────
  useEffect(() => {
    if (!authToken || mode !== "player") return;
    const id = setInterval(() => {
      void refreshTeamState();
      void fetchLeaderboard();
    }, 30000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, mode]);

  // ── Player: clue elapsed timer ────────────────────────────────
  useEffect(() => {
    if (!authToken || mode !== "player") return;
    const clueIdx = teamState?.currentClueIndex;
    if (clueIdx === undefined || clueIdx === null) return;
    const key = `scavenge_clue_start_${clueIdx}`;
    if (!localStorage.getItem(key)) localStorage.setItem(key, String(Date.now()));
    const startMs = Number(localStorage.getItem(key));
    const tick = () => {
      const elapsed = Date.now() - startMs;
      const m = Math.floor(elapsed / 60000);
      const s = Math.floor((elapsed % 60000) / 1000);
      setClueElapsed(`${m}:${s.toString().padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, mode, teamState?.currentClueIndex]);

  // ── Player: cache current clue offline ───────────────────────
  useEffect(() => {
    if (teamState?.currentClue) {
      localStorage.setItem("scavenge_cached_clue", JSON.stringify(teamState.currentClue));
    }
  }, [teamState?.currentClue]);

  // ── Auto-dismiss welcome after 5s ────────────────────────────
  useEffect(() => {
    if (!showWelcome) return;
    const id = setTimeout(() => setShowWelcome(false), 5000);
    return () => clearTimeout(id);
  }, [showWelcome]);

  const deductPoints = async (event: FormEvent) => {
    event.preventDefault();
    if (!deductTeamId.trim()) {
      setStatusMessage("Team id is required for deduction");
      return;
    }

    const amount = Number(deductAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setStatusMessage("Deduction amount must be a positive number");
      return;
    }

    const response = await fetch(`${apiBase}/admin/team/${deductTeamId.trim()}/deduct`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ amount, reason: deductReason })
    });

    if (!response.ok) {
      setStatusMessage(await parseError(response, "Deduction failed"));
      return;
    }

    setStatusMessage(`Deducted ${amount} points from ${deductTeamId}`);
    await Promise.all([fetchLeaderboard(), fetchAuditLogs()]);
  };

  const reopenClue = async (event: FormEvent) => {
    event.preventDefault();
    if (!reopenTeamId.trim()) {
      setStatusMessage("Team id is required to reopen a clue");
      return;
    }

    const clueIndex = Number(reopenClueIndex);
    const durationSeconds = Number(reopenDurationSeconds);
    if (!Number.isInteger(clueIndex) || clueIndex < 0) {
      setStatusMessage("Clue index must be a non-negative integer");
      return;
    }

    const response = await fetch(`${apiBase}/admin/team/${reopenTeamId.trim()}/reopen-clue`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        clueIndex,
        reason: reopenReason,
        durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : undefined
      })
    });

    if (!response.ok) {
      setStatusMessage(await parseError(response, "Reopen clue failed"));
      return;
    }

    setStatusMessage(`Reopened clue ${clueIndex} for ${reopenTeamId}`);
    await Promise.all([fetchAuditLogs(), fetchLeaderboard()]);
  };

  const loadTeamContext = (selectedTeamId: string, currentClueIndex: number) => {
    setDeductTeamId(selectedTeamId);
    setDeductReason("Admin adjustment");
    setReopenTeamId(selectedTeamId);
    setReopenClueIndex(String(Math.max(0, currentClueIndex - 1)));
    setReviewTeamFilter(selectedTeamId);
    setAuditTeamFilter(selectedTeamId);
    setStatusMessage(`Loaded team context for ${selectedTeamId}`);
  };

  const clearTeamContext = () => {
    setDeductTeamId("");
    setDeductReason("Screenshot violation");
    setReopenTeamId("");
    setReopenClueIndex("0");
    setReviewTeamFilter("");
    setScopeSecurityToReviewTeam(true);
    setAuditTeamFilter("");
    setStatusMessage("Cleared team context fields");
  };

  return (
    <div className={mode === "player" ? "" : "container"}>
      {mode === "admin" && <h1>SCAVENGE Admin</h1>}
      {mode === "admin" && <p className="status">Status: {statusMessage}</p>}

      {mode === "player" && (
        <div className="player-app">
          {!authToken ? (
            /* ── Join Screen ──────────────────────────────────── */
            <div className="join-screen">
              <div className="join-logo">🗺️</div>
              <h1 className="join-title">SCAVENGE</h1>
              <p className="join-subtitle">Boyz Weekend 2026 · San Francisco</p>

              {gameStatus?.status === "PENDING" && countdown && (
                <div className="countdown-banner">⏳ Hunt starts in {countdown}</div>
              )}
              {gameStatus?.status === "RUNNING" && (
                <div className="game-live-banner">🟢 Hunt is LIVE — get moving!</div>
              )}
              {gameStatus?.status === "ENDED" && (
                <div className="game-ended-banner">🏁 Hunt has ended</div>
              )}

              <form onSubmit={joinTeam} className="join-form">
                <label className="field-label">Team name</label>
                <div className="team-chip-row" role="radiogroup" aria-label="Team quick select">
                  {TEAM_SUIT_OPTIONS.map((team) => (
                    <button
                      key={team}
                      type="button"
                      data-testid={`team-chip-${team.toLowerCase()}`}
                      className={`team-chip${normalizeTeamCodeInput(joinCode) === team ? " team-chip--active" : ""}`}
                      onClick={() => {
                        setJoinCode(team);
                        setDisplayName("");
                      }}
                    >
                      <span className="team-chip__suit">{TEAM_THEMES[team].suit}</span>
                      <span>{team}</span>
                    </button>
                  ))}
                </div>
                <div className="field-hint">Tap your team, then choose your assigned name from that roster.</div>
                <label className="field-label">Your name</label>
                {selectedJoinParticipants.length > 0 ? (
                  <div className="name-chip-row" role="radiogroup" aria-label="Assigned names">
                    {selectedJoinParticipants.map((participantName) => (
                      <button
                        key={participantName}
                        type="button"
                        className={`name-chip${displayName === participantName ? " name-chip--active" : ""}`}
                        onClick={() => setDisplayName(participantName)}
                      >
                        {participantName}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="empty-roster-note">No players are assigned to this team yet. Ask the Dictator to add you first.</div>
                )}
                <label className="field-label">
                  Captain PIN <span className="field-optional">(captains only — leave blank if member)</span>
                </label>
                <input
                  data-testid="captain-pin-input"
                  className="join-input"
                  type="password"
                  inputMode="numeric"
                  value={captainPin}
                  onChange={(e) => setCaptainPin(e.target.value)}
                  placeholder="6-digit PIN"
                />
                <button data-testid="join-submit-btn" className="join-btn" type="submit" disabled={!displayName}>Join Hunt →</button>
              </form>

              {statusMessage && statusMessage !== "Ready" && (
                <p data-testid="join-status-message" className="join-error">{statusMessage}</p>
              )}
            </div>
          ) : (
            /* ── In-Game Screen ───────────────────────────────── */
            <div className="game-screen">
              {/* Offline banner */}
              {!socketConnected && (
                <div className="offline-banner">⚠️ Reconnecting… some updates may be delayed</div>
              )}

              {/* Header */}
              <header data-testid="player-header" className="player-header">
                <div className="player-header__team">
                  {(() => { const th = getTeamTheme(); return th ? `${th.suit} ${th.fullName}` : `Team ${(teamState?.teamName ?? teamId).toUpperCase()}`; })()}
                  {role === "CAPTAIN" && <span className="captain-badge">👑 Captain</span>}
                </div>
                <div className="player-header__score">
                  {(teamState?.scoreTotal ?? 0).toLocaleString()} pts
                </div>
              </header>

              {/* Progress bar */}
              <div className="progress-track">
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${Math.min(100, ((teamState?.completedCount ?? 0) / 14) * 100)}%` }}
                  />
                </div>
                <div className="progress-meta">
                  Clue {(teamState?.currentClueIndex ?? 0) + 1} of 14
                  &nbsp;·&nbsp; {teamState?.completedCount ?? 0} solved
                  &nbsp;·&nbsp; {teamState?.skippedCount ?? 0} skipped
                  {clueElapsed && <>&nbsp;·&nbsp; ⏱ {clueElapsed}</>}
                  &nbsp;·&nbsp;
                  <span className={(teamState?.completedCount ?? 0) >= 9 ? "eligible" : "ineligible"}>
                    {(teamState?.completedCount ?? 0) >= 9 ? "✅ Eligible" : "⚠️ Need 9 to qualify"}
                  </span>
                </div>
              </div>

              {/* Tab bar */}
              <div className="player-tabs">
                <button
                  className={`player-tab${playerTab === "clue" ? " player-tab--active" : ""}`}
                  onClick={() => { setPlayerTab("clue"); setSabotageTab(false); }}
                >🗺️ Clue</button>
                <button
                  className={`player-tab${playerTab === "leaderboard" ? " player-tab--active" : ""}`}
                  onClick={() => { setPlayerTab("leaderboard"); setSabotageTab(false); void fetchLeaderboard(); }}
                >🏆 Standings</button>
                <button
                  className={`player-tab${sabotageTab ? " player-tab--active" : ""}`}
                  onClick={() => { setSabotageTab(true); setPlayerTab("clue"); void fetchSabotageCatalog(); }}
                >⚡ Sabotage</button>
              </div>

              {/* ── Clue tab ─────────────────────────────────── */}
              {playerTab === "clue" && !sabotageTab && (
                <div className="clue-panel">
                  {/* Waiting for the hunt to start */}
                  {gameStatus?.status === "PENDING" ? (
                    <div className="waiting-room">
                      <div className="waiting-icon">⏳</div>
                      <h2 className="waiting-title">Hunt starts soon</h2>
                      <p className="waiting-body">Wait for the Dictator to kick things off. Your first clue will appear here the moment the hunt goes live.</p>
                      <button className="btn-refresh" onClick={() => { void fetchGameStatus(); void refreshTeamState(); }}>🔄 Check status</button>
                    </div>
                  ) : gameStatus?.status === "PAUSED" ? (
                    <div className="waiting-room waiting-room--paused">
                      <div className="waiting-icon">⏸️</div>
                      <h2 className="waiting-title">Hunt is paused</h2>
                      <p className="waiting-body">Stand by — the Dictator will resume shortly.</p>
                      <button className="btn-refresh" onClick={() => { void fetchGameStatus(); }}>🔄 Check status</button>
                    </div>
                  ) : teamState?.currentClue ? (
                    <>
                      {teamState.currentClue.transport_mode === "WAYMO" && (
                        <div className="transport-banner transport--waymo">🚗 Waymo required to reach this clue</div>
                      )}
                      {teamState.currentClue.transport_mode === "CABLE_CAR" && (
                        <div className="transport-banner transport--cablecar">🚃 Cable car required to reach this clue</div>
                      )}
                      {teamState.currentClue.transport_mode === "WALK" && (
                        <div className="transport-banner transport--walk">🚶 Walk to this location</div>
                      )}

                      {/* Clue reveal gate — tap to see each new clue */}
                      {revealedClueIndex !== teamState.currentClueIndex ? (
                        <div className="clue-reveal">
                          <div className="clue-reveal__number">Clue {(teamState.currentClueIndex ?? 0) + 1}</div>
                          <p className="clue-reveal__hint">Your next clue is ready. Gather your team, then tap to reveal.</p>
                          <button
                            className="btn-reveal"
                            onClick={() => setRevealedClueIndex(teamState.currentClueIndex)}
                          >
                            👁 Reveal Clue {(teamState.currentClueIndex ?? 0) + 1} →
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="clue-card">
                            <div className="clue-number">
                              Clue {(teamState.currentClueIndex ?? 0) + 1}
                              {teamState.currentClue.required_flag
                                ? <span className="clue-required">REQUIRED</span>
                                : <span className="clue-optional">optional</span>}
                            </div>
                            {/* In-person clues 11 & 12: hide text, instruct team to find Dictator */}
                            {teamState.currentClueIndex >= 10 ? (
                              <div className="in-person-clue">
                                <div className="in-person-icon">🎭</div>
                                <h2 className="in-person-title">In-Person Clue</h2>
                                <p className="in-person-body">The Dictator has this one. Find them — they'll give you your instructions face to face.</p>
                              </div>
                            ) : (
                              <>
                                <h2 className="clue-title">{teamState.currentClue.title}</h2>
                                <p className="clue-text">{teamState.currentClue.instructions}</p>
                              </>
                            )}
                          </div>

                          {/* Broadcast message from Dictator */}
                          {broadcastMsg && (
                            <div className="admin-broadcast-banner">
                              📢 <strong>Message from the Dictator:</strong> {broadcastMsg}
                            </div>
                          )}

                          {/* Admin hint for this clue */}
                          {adminHint && adminHint.clueIndex === teamState.currentClueIndex && (
                            <div className="admin-hint-banner">
                              💡 <strong>Hint from the Dictator:</strong> {adminHint.hintText}
                              <button className="admin-hint-dismiss" onClick={() => setAdminHint(null)}>✕</button>
                            </div>
                          )}

                          {/* Verdict */}
                          {lastVerdict && (
                            <div className={`verdict-banner verdict--${lastVerdict === "NEEDS_REVIEW" ? "needs-review" : lastVerdict.toLowerCase()}`}>
                              {lastVerdict === "PASS" && "✅ Correct! Great work — moving to the next clue."}
                              {lastVerdict === "FAIL" && "❌ Not quite — check the feedback below and try again."}
                              {lastVerdict === "NEEDS_REVIEW" && "⏳ Submitted for admin review. Stand by!"}
                              {lastFeedback && <p className="verdict-feedback">{lastFeedback}</p>}
                            </div>
                          )}

                          {/* Captain submit — only visible after clue is revealed */}
                          {role === "CAPTAIN" ? (
                            <div className="submit-panel">
                              <div className="submit-heading">Submit your answer</div>
                              {teamState.currentClue.submission_type === "PHOTO" && (
                                <div className="photo-required-hint">📸 Photo required — include at least 2 team members</div>
                              )}
                              <textarea
                                className="submit-textarea"
                                value={submitText}
                                onChange={(e) => setSubmitText(e.target.value)}
                                placeholder="Describe what you found or did…"
                                rows={3}
                              />
                              <div className="photo-row">
                                <label className="photo-btn">
                                  📷 {submitFile ? "Change photo/video" : "Add photo or video"}
                                  <input
                                    type="file"
                                    accept="image/*,video/*"
                                    capture="environment"
                                    style={{ display: "none" }}
                                    onChange={(e) => {
                                      const file = e.target.files?.[0] ?? null;
                                      setSubmitFile(file);
                                      if (submitPreviewUrl) URL.revokeObjectURL(submitPreviewUrl);
                                      setSubmitPreviewUrl(file ? URL.createObjectURL(file) : null);
                                    }}
                                  />
                                </label>
                                {submitFile && (
                                  <button
                                    className="photo-clear"
                                    type="button"
                                    onClick={() => {
                                      if (submitPreviewUrl) URL.revokeObjectURL(submitPreviewUrl);
                                      setSubmitFile(null);
                                      setSubmitPreviewUrl(null);
                                    }}
                                  >✕ Remove</button>
                                )}
                              </div>
                              {submitPreviewUrl && (
                                <img src={submitPreviewUrl} alt="Preview" className="photo-preview" />
                              )}
                              <div className="submit-actions">
                                <button
                                  className="btn-submit"
                                  onClick={() => { void submitClue(); }}
                                  disabled={
                                    isSubmitting ||
                                    (!submitText.trim() && !submitFile) ||
                                    (teamState.currentClue.submission_type === "PHOTO" && !submitFile)
                                  }
                                >
                                  {isSubmitting ? "Submitting…" : "Submit Answer ✓"}
                                </button>
                                {!teamState.currentClue.required_flag && (
                                  <button
                                    className="btn-pass"
                                    onClick={() => { void passClue(); }}
                                    disabled={isSubmitting || (teamState.skippedCount ?? 0) >= 5}
                                  >Skip this clue</button>
                                )}
                              </div>
                              <div className="passes-counter">
                                {teamState.skippedCount ?? 0} of 5 passes used
                                {(teamState.skippedCount ?? 0) >= 5 && <span className="passes-exhausted"> · No passes remaining</span>}
                              </div>
                            </div>
                          ) : (
                            <div className="member-notice">
                              Only your team captain can submit answers or skip clues.
                            </div>
                          )}
                        </>
                      )}
                    </>
                  ) : (
                    <div className="loading-clue">
                      <p>Loading your clue…</p>
                      <button className="btn-refresh" onClick={() => { void refreshTeamState(); }}>
                        🔄 Tap to load
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ── Leaderboard tab ──────────────────────────── */}
              {playerTab === "leaderboard" && !sabotageTab && (
                <div className="leaderboard-panel">
                  <div className="lb-heading">Live Standings</div>
                  {leaderboard.length === 0 ? (
                    <p className="lb-empty">Loading standings…</p>
                  ) : (
                    <div className="lb-table">
                      {leaderboard
                        .slice()
                        .sort((a, b) => b.scoreTotal - a.scoreTotal)
                        .map((team, i) => (
                          <div
                            key={team.teamId}
                            className={`lb-row${team.teamId === teamId ? " lb-row--me" : ""}`}
                          >
                            <span className="lb-rank">
                              {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                            </span>
                            <span className="lb-name">{team.teamName}</span>
                            <span className="lb-clue">Clue {team.currentClueIndex + 1}</span>
                            <span className="lb-score">{team.scoreTotal.toLocaleString()} pts</span>
                          </div>
                        ))}
                    </div>
                  )}
                  <button className="btn-refresh" onClick={() => { void fetchLeaderboard(); }}>🔄 Refresh</button>
                </div>
              )}

              {/* ── Sabotage tab ──────────────────────────────── */}
              {sabotageTab && (
                <div className="sabotage-panel">
                  <div className="sabotage-balance">
                    ⚡ Sabotage Bank: <strong>{(teamState?.sabotageBalance ?? 0).toLocaleString()} pts</strong>
                  </div>
                  {sabotageCatalog.length === 0 ? (
                    <p className="lb-empty">Loading actions…</p>
                  ) : (
                    sabotageCatalog.map((action: any) => (
                      <div key={action.id} className="sabotage-card">
                        <div className="sabotage-name">{action.name}</div>
                        <div className="sabotage-desc">{action.description}</div>
                        <div className="sabotage-meta">
                          Cost: <strong>{action.cost} pts</strong>
                          {action.cooldown_seconds > 0 && ` · Cooldown: ${Math.ceil(action.cooldown_seconds / 60)}min`}
                        </div>
                        {role === "CAPTAIN" ? (
                          <div className="sabotage-trigger">
                            <input
                              className="join-input"
                              placeholder="Target team (e.g. SPADES)"
                              value={sabotageAction === action.id ? sabotageTarget : ""}
                              onChange={(e) => { setSabotageAction(action.id); setSabotageTarget(e.target.value); }}
                            />
                            <button
                              className="btn-submit"
                              style={{ marginTop: "0.5rem" }}
                              onClick={() => { void triggerSabotage(action.id, sabotageAction === action.id ? sabotageTarget : ""); }}
                              disabled={(teamState?.sabotageBalance ?? 0) < action.cost}
                            >
                              Launch Sabotage
                            </button>
                          </div>
                        ) : (
                          <div className="member-notice" style={{ marginTop: "0.5rem" }}>Only captains can trigger sabotage.</div>
                        )}
                      </div>
                    ))
                  )}
                  <button className="btn-refresh" onClick={() => { void fetchSabotageCatalog(); }}>🔄 Refresh</button>
                </div>
              )}
            </div>
          )}

          {/* ── Info modal ──────────────────────────────────── */}
          {infoModal && (
            <div className="info-overlay" onClick={(e) => { if (e.target === e.currentTarget) setInfoModal(null); }}>
              <div className="info-modal">
                <button className="info-modal__close" onClick={() => setInfoModal(null)}>✕</button>

                {infoModal === "howtoplay" && (
                  <>
                    <h2 className="info-title">🗺️ How to Play</h2>
                    <div className="info-body">
                      <p>Welcome to <strong>Boyz Weekend 2026</strong> — a live scavenger hunt across San Francisco!</p>
                      <h3>Getting Started</h3>
                      <ul>
                        <li>Select your team, then tap your assigned name from that team's roster.</li>
                        <li>Each team starts on a <strong>different clue</strong> — you won't see anyone else's progress until the leaderboard updates.</li>
                        <li>Only the <strong>👑 Captain</strong> can reveal clues, submit answers, and use passes.</li>
                      </ul>
                      <h3>Solving a Clue</h3>
                      <ul>
                        <li>When a new clue is ready, tap <strong>Reveal Clue →</strong> to see it. Rally your team first!</li>
                        <li>Find the location or answer described in the clue.</li>
                        <li>Submit a <strong>photo with at least 2 team members</strong> in it as proof. Text clues still accept a text answer.</li>
                        <li>An AI judge instantly reviews your submission. If it's unclear, an admin reviews it.</li>
                      </ul>
                      <h3>The Last Two Clues</h3>
                      <ul>
                        <li>Clues 11 and 12 are given to you <strong>in person by the Dictator</strong> — no reveal button, just find him.</li>
                      </ul>
                      <h3>Scoring &amp; Winning</h3>
                      <ul>
                        <li>Each clue awards points. Speed and accuracy matter.</li>
                        <li>You can pass up to <strong>5 optional clues</strong> — REQUIRED clues cannot be passed.</li>
                        <li>Final score on the leaderboard determines the winner.</li>
                      </ul>
                      <h3>Sabotage</h3>
                      <ul>
                        <li>Captains can spend points on sabotage actions against rival teams.</li>
                        <li>Check the ⚡ Sabotage tab to see available actions.</li>
                      </ul>
                    </div>
                  </>
                )}

                {infoModal === "rules" && (
                  <>
                    <h2 className="info-title">📋 Rules</h2>
                    <div className="info-body">
                      <ol>
                        <li>Each team has exactly <strong>one captain</strong>. Only the captain can reveal clues, submit answers, pass clues, or trigger sabotage.</li>
                        <li>You may pass up to <strong>5 optional clues</strong>. <strong>REQUIRED clues cannot be passed.</strong></li>
                        <li>Photo submissions must show <strong>at least 2 team members</strong> in the photo.</li>
                        <li><strong>No sharing answers</strong> with other teams. Each team must solve clues independently.</li>
                        <li>Do not travel to a future clue location before unlocking it.</li>
                        <li>Clues 11 and 12 are delivered in person by the Dictator — the app will tell you when to find him.</li>
                        <li>AI verdicts are instant. Admin overrides are final.</li>
                        <li>Disputes must be raised with the admin via the Get Help screen.</li>
                        <li className="rule-final"><strong>The Dictator's decision is always final.</strong></li>
                      </ol>
                    </div>
                  </>
                )}

                {infoModal === "help" && (
                  <>
                    <h2 className="info-title">🆘 Get Help</h2>
                    <div className="info-body">
                      <div className="faq-item">
                        <div className="faq-q">The app won't load or is stuck</div>
                        <div className="faq-a">Close and reopen your browser. Make sure you have a mobile data or Wi-Fi connection. Try refreshing the page.</div>
                      </div>
                      <div className="faq-item">
                        <div className="faq-q">I can't join my team</div>
                        <div className="faq-a">Tap your team, then choose your assigned name from the list for that team. If your name is missing, contact the Dictator. Captains still enter their 6-digit PIN.</div>
                      </div>
                      <div className="faq-item">
                        <div className="faq-q">Our submission keeps getting FAIL</div>
                        <div className="faq-a">Read the AI feedback carefully — it explains exactly what was missing. Make sure your photo includes all required elements listed in the clue. Resubmit as many times as needed while the clue is active.</div>
                      </div>
                      <div className="faq-item">
                        <div className="faq-q">Our answer is stuck in "Needs Review"</div>
                        <div className="faq-a">The admin is reviewing it manually. Stand by — you'll see the verdict appear on screen when it's resolved. Do not resubmit.</div>
                      </div>
                      <div className="faq-item">
                        <div className="faq-q">The leaderboard isn't updating</div>
                        <div className="faq-a">Tap the 🔄 Refresh button on the Standings tab. If it still doesn't update, try switching tabs and coming back.</div>
                      </div>
                      <div className="faq-item">
                        <div className="faq-q">We accidentally skipped a clue</div>
                        <div className="faq-a">Contact the Dictator immediately using the button below. They can reopen a clue with admin tools.</div>
                      </div>
                      <div className="faq-item">
                        <div className="faq-q">The app shows the wrong clue</div>
                        <div className="faq-a">Tap 🔄 Tap to load on the clue panel to force a refresh from the server.</div>
                      </div>
                      <div className="faq-item">
                        <div className="faq-q">Something else is wrong</div>
                        <div className="faq-a">Use the button below to alert the Dictator directly.</div>
                      </div>

                      <div className="help-issue-picker">
                        <div className="help-issue-picker__label">Quick issue type</div>
                        <div className="help-issue-picker__chips">
                          {HELP_ISSUES.map((issue) => (
                            <button
                              key={issue.id}
                              type="button"
                              data-testid={`help-issue-${issue.id.toLowerCase()}`}
                              className={`help-issue-chip${selectedHelpIssueId === issue.id ? " help-issue-chip--active" : ""}`}
                              onClick={() => setSelectedHelpIssueId(issue.id)}
                            >
                              {issue.label}
                            </button>
                          ))}
                        </div>
                        <div className="help-issue-picker__preview">Message topic: {selectedHelpIssue.smsLine}</div>
                      </div>

                      <div className="dictator-actions">
                        <a
                          className="btn-dictator"
                          data-testid="contact-dictator-link"
                          href={buildDictatorSmsHref(false)}
                          onClick={() => { void handleDictatorClick(false); }}
                        >
                          📲 Contact the Dictator
                        </a>
                        <a
                          className="btn-dictator btn-dictator--test"
                          data-testid="contact-dictator-test-link"
                          href={buildDictatorSmsHref(true)}
                          onClick={() => { void handleDictatorClick(true); }}
                        >
                          Send Test Text
                        </a>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── Verdict reveal overlay ──────────────────────── */}
          {verdictReveal && (
            <div className={`verdict-reveal-overlay verdict-reveal-overlay--${verdictReveal === "NEEDS_REVIEW" ? "review" : verdictReveal.toLowerCase()}`}>
              <div className="verdict-reveal-card">
                <div className="verdict-reveal-icon">
                  {verdictReveal === "PASS" && "🎉"}
                  {verdictReveal === "FAIL" && "💥"}
                  {verdictReveal === "NEEDS_REVIEW" && "⏳"}
                </div>
                <div className="verdict-reveal-label">
                  {verdictReveal === "PASS" && "CORRECT!"}
                  {verdictReveal === "FAIL" && "NOT QUITE"}
                  {verdictReveal === "NEEDS_REVIEW" && "UNDER REVIEW"}
                </div>
                <div className="verdict-reveal-sub">
                  {verdictReveal === "PASS" && "Moving to the next clue…"}
                  {verdictReveal === "FAIL" && "Check the feedback and try again"}
                  {verdictReveal === "NEEDS_REVIEW" && "The Dictator is reviewing your submission"}
                </div>
              </div>
            </div>
          )}

          {/* ── Welcome screen overlay ───────────────────────── */}
          {showWelcome && (() => {
            const th = getTeamTheme();
            return (
              <div className="welcome-overlay" onClick={() => setShowWelcome(false)}>
                <div className="welcome-card" onClick={e => e.stopPropagation()}>
                  <div className="welcome-mascot">{th?.mascot ?? "🗺️"}</div>
                  <div className="welcome-suit">{th?.suit}</div>
                  <div className="welcome-team">{th?.fullName ?? (teamState?.teamName ?? joinCode.split("-")[0]).toUpperCase()}</div>
                  <div className="welcome-landmark">{th?.landmark}</div>
                  <div className="welcome-tagline">"{th?.tagline ?? "Let the hunt begin!"}"</div>
                  <button className="join-btn welcome-go-btn" onClick={() => setShowWelcome(false)}>Let's Go! →</button>
                </div>
              </div>
            );
          })()}

          {/* ── Toast container ──────────────────────────────── */}
          {toasts.length > 0 && (
            <div className="toast-container">
              {toasts.map(t => (
                <div key={t.id} className={`toast toast--${t.type}`}>{t.msg}</div>
              ))}
            </div>
          )}

          {/* ── Fixed bottom help bar ───────────────────────── */}
          <div className="help-bar">
            <button className="help-bar__btn" onClick={() => setInfoModal("howtoplay")}>How to Play</button>
            <button className="help-bar__btn" onClick={() => setInfoModal("rules")}>Rules</button>
            <button className="help-bar__btn" onClick={() => setInfoModal("help")}>Get Help</button>
          </div>
        </div>
      )}

      {mode === "admin" && (
        <section>
          <h2>Admin Ops</h2>
          <form onSubmit={adminLogin} className="panel">
            <input data-testid="admin-password-input" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} placeholder="Admin password" />
            <button data-testid="admin-login-button" type="submit">Login Admin</button>
          </form>

          <div className="tabs admin-tabs">
            <button onClick={() => setAdminView("setup")} className={adminView === "setup" ? "active" : ""}>Setup</button>
            <button onClick={() => setAdminView("live-ops")} className={adminView === "live-ops" ? "active" : ""}>Live Ops</button>
          </div>

          {adminView === "setup" && (
            <>
              <h3>Team Assignments</h3>
              <form onSubmit={assignParticipantToTeam} className="panel">
                <select value={assignmentTeamId} onChange={(event) => setAssignmentTeamId(event.target.value)}>
                  {TEAM_SUIT_OPTIONS.map((team) => (
                    <option key={team} value={team.toLowerCase()}>{team}</option>
                  ))}
                </select>
                <input
                  value={assignmentName}
                  onChange={(event) => setAssignmentName(event.target.value)}
                  placeholder="Assign player name to selected team"
                />
                <div className="actions-row">
                  <button type="submit">Assign To Team</button>
                  <button type="button" onClick={() => { void fetchTeamAssignments(); }}>Refresh Assignments</button>
                </div>
              </form>

              <div className="assignment-grid">
                {teamAssignments.map((team) => (
                  <div key={team.teamId} className="assignment-card">
                    <div className="assignment-card__title">{team.teamName}</div>
                    <div className="assignment-card__meta">Captain: {team.captainName}</div>
                    {team.assignedParticipants.length > 0 ? (
                      <div className="assignment-pill-row">
                        {team.assignedParticipants.map((participantName) => (
                          <button
                            key={`${team.teamId}-${participantName}`}
                            type="button"
                            className="assignment-pill"
                            onClick={() => { void removeParticipantFromTeam(team.teamId, participantName); }}
                            title="Remove from team"
                          >
                            <span>{participantName}</span>
                            <span className="assignment-pill__remove">✕</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="assignment-empty">No players assigned yet.</div>
                    )}
                  </div>
                ))}
              </div>

              <h3>Clue Files</h3>
              <form onSubmit={uploadAdminCluesFile} className="panel">
                <select
                  value={adminClueUploadSource}
                  onChange={(event) => setAdminClueUploadSource(event.target.value as AdminClueSource)}
                >
                  <option value="production">Production clues</option>
                  <option value="test">Test clues</option>
                </select>
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => setAdminClueUploadFile(event.target.files?.[0] ?? null)}
                />
                <button type="submit" disabled={adminClueUploadBusy || !adminClueUploadFile}>
                  {adminClueUploadBusy ? "Uploading…" : `Upload ${adminClueUploadSource} clue file`}
                </button>
                <button
                  type="button"
                  onClick={() => { void downloadAdminClueTemplate(adminClueUploadSource); }}
                >
                  Download {adminClueUploadSource} template
                </button>
              </form>

              <h3>Audit Logs</h3>
              <div className="panel filter-row">
                <input
                  value={auditActionFilter}
                  onChange={(event) => setAuditActionFilter(event.target.value)}
                  placeholder="Filter action (e.g., QR_PUBLIC_ID_ROTATED)"
                />
                <input
                  value={auditTeamFilter}
                  onChange={(event) => setAuditTeamFilter(event.target.value)}
                  placeholder="Filter team/target (e.g., spades)"
                />
              </div>
              <div className="panel">
                <button onClick={() => { void fetchAuditLogs(); }}>Load Audit Logs</button>
              </div>
              <pre className="json">{JSON.stringify(filteredAuditLogs, null, 2)}</pre>
            </>
          )}

          {adminView === "live-ops" && (
            <>

          <div className="panel">
            <button onClick={loadAdminDashboard}>Refresh Admin Dashboard</button>
            <button onClick={() => { void fetchReviewQueue(); }}>Load Review Queue</button>
            <button onClick={() => { void fetchSecurityEvents(); }}>Load Security Events</button>
            <button onClick={() => { void fetchAuditLogs(); }}>Load Audit Logs</button>
            <button onClick={fetchLeaderboard}>Load Leaderboard</button>
            <button onClick={fetchGameStatus}>Load Game Status</button>
            <button onClick={clearTeamContext}>Clear Team Context</button>
            <label>
              <input
                type="checkbox"
                checked={liveOpsAutoRefreshEnabled}
                onChange={(event) => setLiveOpsAutoRefreshEnabled(event.target.checked)}
              />
              Auto Refresh
            </label>
            <label>
              <input
                type="checkbox"
                checked={realtimeEnabled}
                onChange={(event) => setRealtimeEnabled(event.target.checked)}
              />
              Realtime Socket
            </label>
            <input
              value={liveOpsPollSeconds}
              onChange={(event) => setLiveOpsPollSeconds(event.target.value)}
              placeholder="Poll seconds (>=3)"
            />
              <input
                value={reviewQueueLimit}
                onChange={(event) => setReviewQueueLimit(event.target.value)}
                placeholder="Review limit"
              />
              <input
                value={reviewQueueOffset}
                onChange={(event) => setReviewQueueOffset(event.target.value)}
                placeholder="Review offset"
              />
              <input
                value={securityEventsLimit}
                onChange={(event) => setSecurityEventsLimit(event.target.value)}
                placeholder="Security limit"
              />
              <input
                value={securityEventsOffset}
                onChange={(event) => setSecurityEventsOffset(event.target.value)}
                placeholder="Security offset"
              />
              <input
                value={auditLogsLimit}
                onChange={(event) => setAuditLogsLimit(event.target.value)}
                placeholder="Audit limit"
              />
              <input
                value={auditLogsOffset}
                onChange={(event) => setAuditLogsOffset(event.target.value)}
                placeholder="Audit offset"
              />
          </div>

          <h3>Game Status</h3>
          <div className="panel">
            <p>
              Current: <strong>{gameStatus?.status ?? "-"}</strong>
            </p>
            <p>
              Game: {gameStatus?.name ?? "-"} ({gameStatus?.timezone ?? "-"})
            </p>
            <p>
              One-click test launch resets to the TEST seed, restarts the backend, then marks the hunt RUNNING.
            </p>
            <div className="actions-row">
              <button onClick={() => { void startTestHunt(); }} disabled={adminStartTestBusy}>
                {adminStartTestBusy ? "Starting Test Hunt…" : "Start Test Hunt"}
              </button>
              <button onClick={() => updateGameStatus("PENDING")}>Set Pending</button>
              <button onClick={() => updateGameStatus("RUNNING")}>Start / Run</button>
              <button onClick={() => updateGameStatus("PAUSED")}>Pause</button>
              <button onClick={() => updateGameStatus("ENDED")}>End</button>
            </div>
          </div>

          <h3>Review Queue</h3>
          <p>Showing {filteredReviewQueue.length} of {reviewQueueTotal}</p>
          <p>{reviewQueuePagination.totalPages === 0 ? "No pages yet" : `Page ${reviewQueuePagination.currentPage} of ${reviewQueuePagination.totalPages}`}</p>
          <div className="panel">
            <button onClick={firstReviewQueuePage} disabled={!reviewQueuePagination.canPrev}>First</button>
            <button onClick={prevReviewQueuePage} disabled={!reviewQueuePagination.canPrev}>Prev</button>
            <button onClick={nextReviewQueuePage} disabled={!reviewQueuePagination.canNext}>Next</button>
            <button onClick={lastReviewQueuePage} disabled={!reviewQueuePagination.canNext}>Last</button>
            <p className="pagination-hint">Pagination uses zero-based offset. Each page jumps by the current review limit.</p>
          </div>
          <div className="panel">
            <input
              value={reviewTeamFilter}
              onChange={(event) => setReviewTeamFilter(event.target.value)}
              placeholder="Filter review team (e.g., spades)"
            />
          </div>
          <div className="panel">
            <input
              value={reviewPassPointsOverride}
              onChange={(event) => setReviewPassPointsOverride(event.target.value)}
              placeholder="PASS points override (optional)"
            />
          </div>
          <ul className="list">
            {filteredReviewQueue.map((item) => (
              <li key={item.id}>
                <span>
                  {item.teamId} / clue {item.clueIndex + 1} / {new Date(item.createdAt).toLocaleTimeString()}
                </span>
                <button
                  onClick={() => {
                    const parsed = Number(reviewPassPointsOverride);
                    const override = Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
                    void resolveReview(item.id, "PASS", override);
                  }}
                >
                  Pass
                </button>
                <button onClick={() => resolveReview(item.id, "FAIL")}>Fail</button>
              </li>
            ))}
          </ul>

          <h3>Security Events</h3>
          <p>Showing {filteredSecurityEvents.length} of {securityEventsTotal}</p>
          <p>{securityEventsPagination.totalPages === 0 ? "No pages yet" : `Page ${securityEventsPagination.currentPage} of ${securityEventsPagination.totalPages}`}</p>
          <div className="panel">
            <button onClick={firstSecurityEventsPage} disabled={!securityEventsPagination.canPrev}>First</button>
            <button onClick={prevSecurityEventsPage} disabled={!securityEventsPagination.canPrev}>Prev</button>
            <button onClick={nextSecurityEventsPage} disabled={!securityEventsPagination.canNext}>Next</button>
            <button onClick={lastSecurityEventsPage} disabled={!securityEventsPagination.canNext}>Last</button>
            <p className="pagination-hint">Pagination uses zero-based offset. Each page jumps by the current security limit.</p>
            <label>
              <input
                type="checkbox"
                checked={scopeSecurityToReviewTeam}
                onChange={(event) => setScopeSecurityToReviewTeam(event.target.checked)}
              />
              Scope to review team filter
            </label>
          </div>
          <ul className="list">
            {filteredSecurityEvents.map((item) => (
              <li key={item.id}>
                <span>
                  {item.teamId} / clue {item.clueIndex + 1} / {item.type} / {new Date(item.timestamp).toLocaleTimeString()}
                </span>
                <button
                  onClick={() => {
                    setDeductTeamId(item.teamId);
                    setDeductReason(`Security event: ${item.type}`);
                    setStatusMessage(`Prepared deduction for ${item.teamId}`);
                  }}
                >
                  Deduct Points
                </button>
              </li>
            ))}
          </ul>

          <h3>Deduct Points</h3>
          <form onSubmit={deductPoints} className="panel">
            <input value={deductTeamId} onChange={(event) => setDeductTeamId(event.target.value)} placeholder="Team id (e.g., spades)" />
            <input value={deductAmount} onChange={(event) => setDeductAmount(event.target.value)} placeholder="Amount" />
            <input value={deductReason} onChange={(event) => setDeductReason(event.target.value)} placeholder="Reason" />
            <button type="submit">Apply Deduction</button>
          </form>

          <h3>Reopen Clue</h3>
          <form onSubmit={reopenClue} className="panel">
            <input value={reopenTeamId} onChange={(event) => setReopenTeamId(event.target.value)} placeholder="Team id (e.g., spades)" />
            <input value={reopenClueIndex} onChange={(event) => setReopenClueIndex(event.target.value)} placeholder="Clue index (0-11)" />
            <input value={reopenDurationSeconds} onChange={(event) => setReopenDurationSeconds(event.target.value)} placeholder="Duration seconds" />
            <input value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} placeholder="Reason" />
            <button type="submit">Reopen</button>
          </form>

          <h3>Leaderboard Snapshot</h3>
          <ul className="list">
            {leaderboard.map((item) => (
              <li key={item.teamId}>
                <span>
                  {item.teamName} ({item.teamId}) / {item.scoreTotal} pts / clue {item.currentClueIndex + 1}
                </span>
                <button
                  onClick={() => {
                    loadTeamContext(item.teamId, item.currentClueIndex);
                  }}
                >
                  Load Team Context
                </button>
                <button
                  onClick={() => {
                    setReopenTeamId(item.teamId);
                    setReopenClueIndex(String(Math.max(0, item.currentClueIndex - 1)));
                    setStatusMessage(`Prepared reopen form for ${item.teamId}`);
                  }}
                >
                  Prepare Reopen
                </button>
              </li>
            ))}
          </ul>

          <h3>Audit Logs</h3>
          <p>Showing {filteredAuditLogs.length} of {auditLogsTotal}</p>
          <p>{auditLogsPagination.totalPages === 0 ? "No pages yet" : `Page ${auditLogsPagination.currentPage} of ${auditLogsPagination.totalPages}`}</p>
          <div className="panel">
            <button onClick={firstAuditLogsPage} disabled={!auditLogsPagination.canPrev}>First</button>
            <button onClick={prevAuditLogsPage} disabled={!auditLogsPagination.canPrev}>Prev</button>
            <button onClick={nextAuditLogsPage} disabled={!auditLogsPagination.canNext}>Next</button>
            <button onClick={lastAuditLogsPage} disabled={!auditLogsPagination.canNext}>Last</button>
            <p className="pagination-hint">Pagination uses zero-based offset. Each page jumps by the current audit limit.</p>
          </div>
          <div className="panel filter-row">
            <input
              value={auditActionFilter}
              onChange={(event) => setAuditActionFilter(event.target.value)}
              placeholder="Filter action (e.g., POINTS_DEDUCTED)"
            />
            <input
              value={auditTeamFilter}
              onChange={(event) => setAuditTeamFilter(event.target.value)}
              placeholder="Filter team/target (e.g., hearts)"
            />
          </div>
          <pre className="json">{JSON.stringify(filteredAuditLogs, null, 2)}</pre>

          <h3>Realtime Events</h3>
          <div className="event-log">
            {realtimeEvents.length === 0 ? <p>No realtime events yet.</p> : null}
            {realtimeEvents.map((item) => (
              <div key={item.id} className="event-row">
                <div className="event-meta">{new Date(item.timestamp).toLocaleTimeString()} · {item.event}</div>
                <div>{item.message}</div>
              </div>
            ))}
          </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

export default App;
