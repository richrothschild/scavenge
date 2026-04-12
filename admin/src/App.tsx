import { Component, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
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
  textContent?: string;
  mediaUrl?: string;
  aiScore?: number;
  aiReasons?: string[];
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

type AdminTeamAssignment = JoinTeamOption & {
  captainPin: string;
};

type GameStatus = "PENDING" | "RUNNING" | "PAUSED" | "ENDED";

type GameStatusPayload = {
  status: GameStatus;
  name: string;
  timezone: string;
  start_time?: string;
  testMode?: boolean;
  joinLocked?: boolean;
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

// ── FIX 6: React Error Boundary ──────────────────────────────────────────────
type EBState = { hasError: boolean; error: string };
class ErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: "" };
  }
  static getDerivedStateFromError(error: unknown): EBState {
    return { hasError: true, error: error instanceof Error ? error.message : String(error) };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:"2rem", textAlign:"center", background:"#0f172a", color:"#f8fafc" }}>
          <div style={{ fontSize:"3rem", marginBottom:"1rem" }}>⚠️</div>
          <h2 style={{ margin:"0 0 0.5rem" }}>Something went wrong</h2>
          <p style={{ color:"rgba(255,255,255,0.6)", marginBottom:"1.5rem", fontSize:"0.9rem" }}>{this.state.error}</p>
          <button
            onClick={() => { this.setState({ hasError: false, error: "" }); window.location.reload(); }}
            style={{ background:"#1d4ed8", color:"#fff", border:"none", borderRadius:"8px", padding:"0.6rem 1.4rem", fontSize:"1rem", cursor:"pointer" }}
          >
            Reload app
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── FIX 1: fetch() with timeout helper ───────────────────────────────────────
const fetchWithTimeout = (url: string, options: RequestInit = {}, ms = 20000): Promise<Response> => {
  const controller = new AbortController();
  const id = window.setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => window.clearTimeout(id));
};

// ── FIX 7: Client-side image compression ─────────────────────────────────────
const compressImage = (file: File, maxDimension = 1280, quality = 0.82): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const { width, height } = img;
      const scale = Math.min(1, maxDimension / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas not available")); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Image load failed")); };
    img.src = objectUrl;
  });
};

function App({ forceMode }: { forceMode?: "player" | "admin" } = {}) {
  const isAdminPath = forceMode ? forceMode === "admin" : window.location.pathname.startsWith("/admin");
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
  const [pointsAdjustMode, setPointsAdjustMode] = useState<"award" | "deduct">("award");
  const [awardTeamId, setAwardTeamId] = useState("");
  const [awardAmount, setAwardAmount] = useState("10");
  const [awardReason, setAwardReason] = useState("");
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
  const [socketConnected, setSocketConnected] = useState(false);
  const [adminClueUploadSource, setAdminClueUploadSource] = useState<AdminClueSource>("production");
  const [adminClueUploadFile, setAdminClueUploadFile] = useState<File | null>(null);
  const [adminClueUploadBusy, setAdminClueUploadBusy] = useState(false);
  const [adminStartTestBusy, setAdminStartTestBusy] = useState(false);
  const [adminStartProdBusy, setAdminStartProdBusy] = useState(false);
  const [adminEndHuntBusy, setAdminEndHuntBusy] = useState(false);
  const [joinLockBusy, setJoinLockBusy] = useState(false);

  // Event results
  type EventResultEntry = { teamId: string; place: 1 | 2 | 3; pointsAwarded: number };
  type EventItem = {
    id: string; title: string; date: string; time: string;
    firstPlaceBonus: number; secondPlaceBonus: number; thirdPlaceBonus: number;
    basePoints: number; weight: number; results: EventResultEntry[];
  };
  const [eventsList, setEventsList] = useState<EventItem[]>([]);
  // Per-event, per-team custom point values: { [eventId]: { spades: "15", hearts: "0", ... } }
  const [eventResults, setEventResults] = useState<Record<string, Record<string, string>>>({});
  const [eventResultMsg, setEventResultMsg] = useState<Record<string, string>>({});
  const [eventResultBusy, setEventResultBusy] = useState<Record<string, boolean>>({});
  const [teamAssignments, setTeamAssignments] = useState<AdminTeamAssignment[]>([]);
  const [assignmentTeamId, setAssignmentTeamId] = useState("spades");
  const [assignmentName, setAssignmentName] = useState("");
  const [captainAssignmentTeamId, setCaptainAssignmentTeamId] = useState("spades");
  const [captainAssignmentName, setCaptainAssignmentName] = useState("");
  const [captainAssignmentPin, setCaptainAssignmentPin] = useState("");
  const [captainAssignmentForceOverride, setCaptainAssignmentForceOverride] = useState(false);
  // ── Verdict reveal overlay ────────────────────────────────────
  const [verdictReveal, setVerdictReveal] = useState<"PASS" | "FAIL" | "NEEDS_REVIEW" | null>(null);
  const lastSeenClueIndexRef = useRef<number | null>(null);
  // ── Welcome screen ────────────────────────────────────────────
  const [showWelcome, setShowWelcome] = useState(false);
  // ── Clue reveal gate (shows tap-to-reveal on each new clue) ──
  const [revealedClueIndexState, setRevealedClueIndexState] = useState<number | null>(null);
  // ── Toast notifications ───────────────────────────────────────
  const [toasts, setToasts] = useState<Array<{ id: string; type: "success" | "error" | "info"; msg: string }>>([]);
  // ── Clue elapsed timer ────────────────────────────────────────
  const [clueElapsed, setClueElapsed] = useState("");
  // ── FIX 5: Skip confirmation ──────────────────────────────────
  const [skipConfirmPending, setSkipConfirmPending] = useState(false);
  // ── FIX 7: Upload progress text ──────────────────────────────
  const [uploadProgress, setUploadProgress] = useState<string>("");
  // ── FIX 8: Member join warning confirmation ───────────────────
  const [memberJoinConfirmed, setMemberJoinConfirmed] = useState(false);

  // ── Admin Events management ───────────────────────────────────
  type EventResult = { teamId: string; place: 1 | 2 | 3; pointsAwarded: number };
  type AdminEventItem = { id: string; title: string; description: string; date: string; time: string; location: string; category: string; sortOrder: number; basePoints: number; weight: number; firstPlaceBonus: number; secondPlaceBonus: number; thirdPlaceBonus: number; results: EventResult[]; };
  const [adminEvents, setAdminEvents] = useState<AdminEventItem[]>([]);
  const [evTitle, setEvTitle] = useState("");
  const [evDesc, setEvDesc] = useState("");
  const [evDate, setEvDate] = useState("2026-04-11");
  const [evTime, setEvTime] = useState("");
  const [evLocation, setEvLocation] = useState("");
  const [evCategory, setEvCategory] = useState("other");
  const [evSortOrder, setEvSortOrder] = useState("0");
  const [evBasePoints, setEvBasePoints] = useState("0");
  const [evWeight, setEvWeight] = useState("1");
  const [evFirstBonus, setEvFirstBonus] = useState("0");
  const [evSecondBonus, setEvSecondBonus] = useState("0");
  const [evThirdBonus, setEvThirdBonus] = useState("0");
  const [evEditId, setEvEditId] = useState<string | null>(null);
  const [evMsg, setEvMsg] = useState("");
  // Results recording
  const [resultsEventId, setResultsEventId] = useState<string | null>(null);
  const [resultsFirst, setResultsFirst] = useState("");
  const [resultsSecond, setResultsSecond] = useState("");
  const [resultsThird, setResultsThird] = useState("");
  const [resultsMsg, setResultsMsg] = useState("");

  // ── Bulk team import ──────────────────────────────────────────
  const [bulkTeamJson, setBulkTeamJson] = useState("");
  const [bulkTeamMsg, setBulkTeamMsg] = useState("");
  const [bulkTeamBusy, setBulkTeamBusy] = useState(false);
  const [bulkTeamReplace, setBulkTeamReplace] = useState(false);

  // ── Bulk events import ────────────────────────────────────────
  const [bulkEvJson, setBulkEvJson] = useState("");
  const [bulkEvMsg, setBulkEvMsg] = useState("");
  const [bulkEvBusy, setBulkEvBusy] = useState(false);
  const [bulkEvReplace, setBulkEvReplace] = useState(false);

  // ── Packing list management ───────────────────────────────────
  type PackingItem = { id: string; text: string; category: string; sortOrder: number; note: string };
  const [packingItems, setPackingItems] = useState<PackingItem[]>([]);
  const [pkText, setPkText] = useState("");
  const [pkCategory, setPkCategory] = useState("other");
  const [pkNote, setPkNote] = useState("");
  const [pkSortOrder, setPkSortOrder] = useState("0");
  const [pkEditId, setPkEditId] = useState<string | null>(null);
  const [pkMsg, setPkMsg] = useState("");

  // ── FIX 3: revealedClueIndex backed by localStorage ──────────
  useEffect(() => {
    if (!teamId) return;
    const saved = localStorage.getItem(`scavenge_revealed_${teamId}`);
    if (saved !== null) setRevealedClueIndexState(Number(saved));
  }, [teamId]);

  const setRevealedClueIndex = (index: number | null) => {
    setRevealedClueIndexState(index);
    if (teamId) {
      if (index === null) {
        localStorage.removeItem(`scavenge_revealed_${teamId}`);
      } else {
        localStorage.setItem(`scavenge_revealed_${teamId}`, String(index));
      }
    }
  };

  const revealedClueIndex = revealedClueIndexState;

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

  const createIdempotencyKey = (scope: string) => {
    const randomPart = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${scope}-${randomPart}`;
  };

  const buildAdminMutationHeaders = (scope: string, tokenOverride?: string) => ({
    ...getAdminHeaders(tokenOverride),
    "x-idempotency-key": createIdempotencyKey(scope)
  });

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

  const addToast = (type: "success" | "error" | "info", msg: string, durationMs = 3500) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts(prev => [...prev, { id, type, msg }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), durationMs);
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

  const selectedCaptainAssignmentTeam = useMemo(
    () => teamAssignments.find((team) => team.teamId === captainAssignmentTeamId) ?? null,
    [captainAssignmentTeamId, teamAssignments]
  );

  const captainAssignmentRoster = selectedCaptainAssignmentTeam?.assignedParticipants ?? [];

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
    const trimmedPin = captainPin.trim();
    // In test mode the backend grants CAPTAIN to everyone — skip the PIN warning
    if (!gameStatus?.testMode && !trimmedPin && !memberJoinConfirmed) {
      setMemberJoinConfirmed(true);
      setStatusMessage("No captain PIN entered — you'll join as a member and won't be able to submit answers. Tap Join Hunt again to confirm.");
      return;
    }
    const endpoint = `${apiBase}/auth/join`;
    let response: Response;

    try {
      // FIX 1: use fetchWithTimeout
      response = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          joinCode: normalizeTeamCodeInput(joinCode),
          displayName: displayName.trim(),
          captainPin: trimmedPin ? captainPin : undefined
        })
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setStatusMessage("Request timed out — check your connection and try again.");
      } else {
        setStatusMessage(formatNetworkError("Join", endpoint, error));
      }
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
    // FIX 2: Persist session in sessionStorage
    sessionStorage.setItem("scavenge_session", JSON.stringify({
      token: payload.session.token,
      role: payload.session.role,
      teamId: payload.session.teamId
    }));
    void fetchGameStatus();
    await refreshTeamState(payload.session.token);
    setStatusMessage(`Joined as ${payload.session.role}`);
  };

  const fetchJoinOptions = async () => {
    const endpoint = `${apiBase}/join/options`;
    let response: Response;
    try {
      response = await fetchWithTimeout(endpoint);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setStatusMessage("Request timed out — check your connection and try again.");
      } else {
        setStatusMessage(formatNetworkError("Join options fetch", endpoint, error));
      }
      return;
    }

    if (!response.ok) {
      setStatusMessage(await parseError(response, "Join options fetch failed"));
      return;
    }

    const payload = await response.json();
    setJoinOptions(payload.teams || []);
  };

  const handleAdminExpired = () => {
    setAdminToken("");
    setTeamAssignments([]);
    setStatusMessage("Admin session expired — please log in again.");
  };

  const fetchTeamAssignments = async () => {
    const response = await fetch(`${apiBase}/admin/team-assignments`, { headers: adminHeaders });
    const payload = await response.json();
    if (!response.ok) {
      if (response.status === 401) { handleAdminExpired(); return; }
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
      headers: buildAdminMutationHeaders("team-assign"),
      body: JSON.stringify({ teamId: assignmentTeamId, participantName: trimmedName })
    });
    const payload = await response.json();
    if (!response.ok) {
      if (response.status === 401) { handleAdminExpired(); return; }
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

  const assignCaptainToTeam = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedCaptainName = captainAssignmentName.trim();
    const trimmedCaptainPin = captainAssignmentPin.trim();

    if (!trimmedCaptainName) {
      setStatusMessage("Captain name is required");
      return;
    }

    if (!/^\d{6}$/.test(trimmedCaptainPin)) {
      setStatusMessage("Captain PIN must be exactly 6 digits");
      return;
    }

    const captainOnRoster = captainAssignmentRoster.some(
      (name) => name.trim().toLowerCase() === trimmedCaptainName.toLowerCase()
    );
    if (!captainOnRoster) {
      setStatusMessage("Captain must already be assigned to this team roster before promotion");
      return;
    }

    const response = await fetch(`${apiBase}/admin/team-assignments/captain`, {
      method: "POST",
      headers: buildAdminMutationHeaders("captain-assign"),
      body: JSON.stringify({
        teamId: captainAssignmentTeamId,
        captainName: trimmedCaptainName,
        captainPin: trimmedCaptainPin,
        forceOverride: captainAssignmentForceOverride
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      if (response.status === 401) { handleAdminExpired(); return; }
      setStatusMessage(payload.error || "Captain assignment failed");
      return;
    }

    setStatusMessage(
      payload.forceOverrideApplied
        ? `Updated captain for ${payload.teamId} to ${payload.captainName} (force override)`
        : `Updated captain for ${payload.teamId} to ${payload.captainName}`
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
    let response: Response;
    try {
      response = await fetchWithTimeout(`${apiBase}/team/me/state`, { headers: getPlayerHeaders(effectiveToken) });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setStatusMessage("Request timed out — check your connection and try again.");
      }
      return;
    }
    if (response.status === 401) {
      setAuthToken("");
      setRole(null);
      setTeamId("");
      setTeamState(null);
      // FIX 2: also clear sessionStorage on 401
      sessionStorage.removeItem("scavenge_session");
      setStatusMessage("Your session expired — please rejoin the hunt.");
      return;
    }
    const payload = await response.json();
    if (!response.ok) {
      setStatusMessage(payload.error || "Unable to fetch team state");
      return;
    }
    setTeamState(payload);
    // FIX 9: Restore pending hint from server state
    if (payload.pendingHint && typeof payload.pendingHint === 'object') {
      setAdminHint(payload.pendingHint as { clueIndex: number; hintText: string });
    }
  };

  const submitClue = async () => {
    const endpoint = `${apiBase}/team/me/submit`;
    setIsSubmitting(true);
    try {
      let mediaData: string | undefined;
      if (submitFile) {
        if (submitFile.type.startsWith("image/")) {
          // FIX 7 + FIX 11: compress image with progress indicator
          setUploadProgress("Compressing photo…");
          mediaData = await compressImage(submitFile);
        } else {
          mediaData = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(submitFile);
          });
        }
      }

      // FIX 11: show uploading state
      setUploadProgress("Uploading…");
      // FIX 1: use fetchWithTimeout
      let response: Response;
      try {
        response = await fetchWithTimeout(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ textContent: submitText, mediaUrl: mediaData })
        });
      } catch (fetchError) {
        if (fetchError instanceof Error && fetchError.name === "AbortError") {
          throw new Error("Request timed out — check your connection and try again.");
        }
        throw fetchError;
      }

      const rawBody = await response.text();
      let payload: any = {};
      if (rawBody.trim()) {
        try {
          payload = JSON.parse(rawBody);
        } catch {
          payload = {};
        }
      }

      if (response.status === 401) {
        setAuthToken("");
        setRole(null);
        setTeamId("");
        setTeamState(null);
        const msg = "Your session expired — please rejoin the hunt.";
        setStatusMessage(msg);
        addToast("error", msg);
        return;
      }

      if (!response.ok) {
        const fallback = `Submit failed (HTTP ${response.status})`;
        const message =
          typeof payload?.error === "string" && payload.error.trim()
            ? payload.error
            : rawBody.trim() && rawBody.length <= 240
              ? rawBody
              : fallback;
        setStatusMessage(message);
        addToast("error", message);
        return;
      }

      const verdict = payload.verdict as "PASS" | "FAIL" | "NEEDS_REVIEW";
      if (verdict !== "PASS" && verdict !== "FAIL" && verdict !== "NEEDS_REVIEW") {
        setStatusMessage("Submit succeeded but response was invalid. Refreshing team state.");
        await refreshTeamState();
        return;
      }
      setLastVerdict(verdict === "PASS" ? null : verdict);
      const reasons = Array.isArray(payload?.ai?.reasons) ? payload.ai.reasons.join("; ") : "";
      setLastFeedback(verdict === "PASS" ? "" : (reasons || `Submission verdict: ${verdict}`));
      setStatusMessage(`Submission verdict: ${verdict}`);
      // Verdict reveal + haptic + toast (FIX 10: longer duration for FAIL/NEEDS_REVIEW)
      setVerdictReveal(verdict === "PASS" ? null : verdict);
      haptic(verdict === "PASS" ? [100, 50, 150] : verdict === "FAIL" ? [200] : [50]);
      addToast(
        verdict === "PASS" ? "success" : verdict === "FAIL" ? "error" : "info",
        verdict === "PASS" ? "Correct! Moving to next clue." : verdict === "FAIL" ? "Not quite — check the feedback." : "Submitted for admin review.",
        verdict === "PASS" ? 3500 : 8000
      );
      if (verdict !== "PASS") {
        setTimeout(() => setVerdictReveal(null), 2500);
      }
      if (verdict === "PASS") {
        setSubmitText("");
        setSubmitFile(null);
        setSubmitPreviewUrl(null);
        setRevealedClueIndex(null);
      }

      if (payload.teamState) {
        setTeamState(payload.teamState);
      }
      await refreshTeamState();
    } catch (error) {
      const message = error instanceof Error ? error.message : formatNetworkError("Submit", endpoint, error);
      setStatusMessage(message);
      addToast("error", message);
    } finally {
      setIsSubmitting(false);
      setUploadProgress("");
    }
  };

  const passClue = async () => {
    if (isSubmitting) return;
    const endpoint = `${apiBase}/team/me/pass`;
    setIsSubmitting(true);
    try {
      let response: Response;
      try {
        response = await fetchWithTimeout(endpoint, { method: "POST", headers });
      } catch (fetchError) {
        if (fetchError instanceof Error && fetchError.name === "AbortError") {
          setStatusMessage("Request timed out — check your connection and try again.");
          addToast("error", "Request timed out — check your connection and try again.");
        } else {
          const message = formatNetworkError("Skip", endpoint, fetchError);
          setStatusMessage(message);
          addToast("error", "Skip failed. Check connection and try again.");
        }
        return;
      }

      if (response.status === 401) {
        setAuthToken("");
        setRole(null);
        setTeamId("");
        setTeamState(null);
        const msg = "Your session expired — please rejoin the hunt.";
        setStatusMessage(msg);
        addToast("error", msg);
        return;
      }

      let payload: any = {};
      try { payload = await response.json(); } catch { /* empty body */ }

      if (!response.ok) {
        const msg = typeof payload?.error === "string" && payload.error.trim()
          ? payload.error
          : "Skip failed — try again.";
        setStatusMessage(msg);
        addToast("error", msg);
        return;
      }

      setLastVerdict(null);
      setLastFeedback("");
      setStatusMessage("Clue skipped");
      setRevealedClueIndex(null);

      if (payload.teamState) {
        setTeamState(payload.teamState);
        return;
      }

      await refreshTeamState();
    } catch (error) {
      const message = formatNetworkError("Skip", endpoint, error);
      setStatusMessage(message);
      addToast("error", "Skip failed. Check connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
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
      response = await fetchWithTimeout(endpoint);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setStatusMessage("Request timed out — check your connection and try again.");
      } else {
        setStatusMessage(formatNetworkError("Game status fetch", endpoint, error));
      }
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
      headers: buildAdminMutationHeaders("game-status"),
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
        headers: buildAdminMutationHeaders("game-status", activeAdminToken),
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

  const startProductionHunt = async () => {
    if (!adminToken) {
      setStatusMessage("Admin login required");
      return;
    }

    const confirmed = window.confirm(
      "Reset to the PRODUCTION hunt and start the game now? This wipes current progress and loads the real clues."
    );
    if (!confirmed) return;

    setAdminStartProdBusy(true);
    try {
      let activeAdminToken = adminToken;

      setStatusMessage("Resetting to PRODUCTION hunt…");
      const resetResponse = await fetch(`${apiBase}/admin/reset-seed`, {
        method: "POST",
        headers: getAdminHeaders(activeAdminToken),
        body: JSON.stringify({ variant: "production" })
      });

      if (!resetResponse.ok) {
        setStatusMessage(await parseError(resetResponse, "Production hunt reset failed"));
        return;
      }

      const resetPayload = await resetResponse.json() as SeedResetResponse;

      if (resetPayload.requiresRestart) {
        setStatusMessage("Production hunt loaded. Restarting backend…");
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

      setStatusMessage("Starting PRODUCTION hunt…");
      const statusResponse = await fetch(`${apiBase}/game/status`, {
        method: "POST",
        headers: buildAdminMutationHeaders("game-status", activeAdminToken),
        body: JSON.stringify({ status: "RUNNING" })
      });

      if (!statusResponse.ok) {
        setStatusMessage(await parseError(statusResponse, "Production hunt start failed"));
        return;
      }

      const statusPayload = await statusResponse.json() as GameStatusPayload;
      setGameStatus(statusPayload);
      await Promise.all([fetchLeaderboard(), fetchTeamAssignments(), fetchAuditLogs(), fetchReviewQueue(), fetchSecurityEvents()]);
      setStatusMessage(`PRODUCTION hunt started with ${resetPayload.clueCount} clues (${resetPayload.resolvedSource} source).`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setStatusMessage(`Start PRODUCTION hunt failed: ${reason}`);
    } finally {
      setAdminStartProdBusy(false);
    }
  };

  const endHunt = async () => {
    if (!adminToken) {
      setStatusMessage("Admin login required");
      return;
    }

    const currentlyEnded = gameStatus?.status === "ENDED";
    const nextStatus: GameStatus = currentlyEnded ? "RUNNING" : "ENDED";
    const confirmMsg = currentlyEnded
      ? "Turn the hunt back ON? This sets the game to RUNNING. Teams will be able to submit answers again."
      : "Turn off the scavenger hunt? This sets the game to ENDED. Teams will no longer be able to submit answers.";

    const confirmed = window.confirm(confirmMsg);
    if (!confirmed) return;

    setAdminEndHuntBusy(true);
    try {
      const response = await fetch(`${apiBase}/game/status`, {
        method: "POST",
        headers: buildAdminMutationHeaders("game-status"),
        body: JSON.stringify({ status: nextStatus })
      });

      if (!response.ok) {
        setStatusMessage(await parseError(response, "Hunt status update failed"));
        return;
      }

      const payload = await response.json() as GameStatusPayload;
      setGameStatus(payload);
      setStatusMessage(currentlyEnded ? "Hunt is now RUNNING. Teams can submit again." : "Hunt ended. All gameplay is now locked.");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setStatusMessage(`Hunt status update failed: ${reason}`);
    } finally {
      setAdminEndHuntBusy(false);
    }
  };

  const toggleJoinLock = async () => {
    setJoinLockBusy(true);
    try {
      const response = await fetch(`${apiBase}/admin/join-lock/toggle`, {
        method: "POST",
        headers: buildAdminMutationHeaders("join-lock"),
      });
      if (!response.ok) {
        setStatusMessage(await parseError(response, "Join lock toggle failed"));
        return;
      }
      const payload = await response.json() as GameStatusPayload;
      setGameStatus(payload);
      setStatusMessage(payload.joinLocked ? "Entry locked — no new players can join." : "Entry unlocked — players can join.");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setStatusMessage(`Join lock toggle failed: ${reason}`);
    } finally {
      setJoinLockBusy(false);
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

  const EVENT_TEAMS = ["spades", "hearts", "diamonds", "clubs"];

  const fetchEventsList = async () => {
    try {
      const res = await fetch(`${apiBase}/events`);
      if (res.ok) {
        const data = await res.json();
        const scored = (data.events ?? []).filter((e: EventItem) => e.firstPlaceBonus > 0 || e.secondPlaceBonus > 0 || e.thirdPlaceBonus > 0);
        setEventsList(scored);
        const init: Record<string, Record<string, string>> = {};
        for (const ev of scored as EventItem[]) {
          const teamPts: Record<string, string> = {};
          for (const t of EVENT_TEAMS) {
            const r = ev.results.find(r => r.teamId === t);
            teamPts[t] = r ? String(r.pointsAwarded) : "0";
          }
          init[ev.id] = teamPts;
        }
        setEventResults(init);
      }
    } catch { /* ignore */ }
  };

  const submitEventResult = async (eventId: string) => {
    setEventResultBusy(b => ({ ...b, [eventId]: true }));
    setEventResultMsg(m => ({ ...m, [eventId]: "" }));
    try {
      const teamPts = eventResults[eventId] ?? {};
      // Sort by points descending to assign places
      const sorted = EVENT_TEAMS
        .map(t => ({ teamId: t, pts: Math.max(0, parseInt(teamPts[t] ?? "0", 10) || 0) }))
        .filter(t => t.pts > 0)
        .sort((a, b) => b.pts - a.pts);
      // Assign place by rank (ties share the same place)
      let currentPlace = 1;
      const results = sorted.map((entry, i) => {
        if (i > 0 && entry.pts < sorted[i - 1]!.pts) currentPlace = i + 1;
        return { teamId: entry.teamId, place: Math.min(currentPlace, 3) as 1|2|3, pointsAwarded: entry.pts };
      });
      const res = await fetch(`${apiBase}/admin/events/${eventId}/results`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": adminToken },
        body: JSON.stringify({ results }),
      });
      const data = await res.json();
      if (res.ok) {
        const total = results.reduce((s, r) => s + r.pointsAwarded, 0);
        setEventResultMsg(m => ({ ...m, [eventId]: `✓ Saved — ${total}pts awarded` }));
        await fetchEventsList();
        await fetchLeaderboard();
      } else {
        setEventResultMsg(m => ({ ...m, [eventId]: data.error ?? "Error saving" }));
      }
    } catch {
      setEventResultMsg(m => ({ ...m, [eventId]: "Network error" }));
    } finally {
      setEventResultBusy(b => ({ ...b, [eventId]: false }));
    }
  };

  const fetchLeaderboard = async () => {
    const endpoint = `${apiBase}/leaderboard`;
    let response: Response;
    try {
      response = await fetchWithTimeout(endpoint);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setStatusMessage("Request timed out — check your connection and try again.");
      } else {
        setStatusMessage(formatNetworkError("Leaderboard fetch", endpoint, error));
      }
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

  // ── Events management helpers ─────────────────────────────────
  const fetchAdminEvents = async () => {
    const res = await fetch(`${apiBase}/events`);
    if (res.ok) { const data = await res.json(); setAdminEvents(data.events ?? []); }
  };

  const fetchPackingItems = async () => {
    const res = await fetch(`${apiBase}/packing`);
    if (res.ok) { const data = await res.json(); setPackingItems(data.items ?? []); }
  };

  const clearPkForm = () => {
    setPkEditId(null); setPkText(""); setPkCategory("other"); setPkNote(""); setPkSortOrder("0"); setPkMsg("");
  };

  const savePkItem = async () => {
    if (!pkText.trim()) { setPkMsg("Item text is required."); return; }
    const body = { text: pkText.trim(), category: pkCategory, note: pkNote.trim(), sortOrder: Number(pkSortOrder) };
    const url = pkEditId ? `${apiBase}/admin/packing/${pkEditId}` : `${apiBase}/admin/packing`;
    const method = pkEditId ? "PUT" : "POST";
    const res = await fetch(url, { method, headers: adminHeaders, body: JSON.stringify(body) });
    const data = await res.json();
    if (res.ok) { setPkMsg(`✓ Item ${pkEditId ? "updated" : "added"}`); clearPkForm(); await fetchPackingItems(); }
    else { setPkMsg(`Error: ${data.error ?? "Unknown"}`); }
  };

  const deletePkItem = async (id: string) => {
    const res = await fetch(`${apiBase}/admin/packing/${id}`, { method: "DELETE", headers: adminHeaders });
    if (res.ok || res.status === 204) { setPkMsg("✓ Item deleted"); await fetchPackingItems(); }
    else setPkMsg("Delete failed");
  };

  const startEditPkItem = (item: PackingItem) => {
    setPkEditId(item.id); setPkText(item.text); setPkCategory(item.category);
    setPkNote(item.note); setPkSortOrder(String(item.sortOrder)); setPkMsg("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const clearEvForm = () => {
    setEvEditId(null); setEvTitle(""); setEvDesc(""); setEvTime(""); setEvLocation("");
    setEvCategory("other"); setEvSortOrder("0"); setEvBasePoints("0"); setEvWeight("1");
    setEvFirstBonus("0"); setEvSecondBonus("0"); setEvThirdBonus("0"); setEvMsg("");
  };

  const saveEvent = async () => {
    if (!evTitle.trim() || !evLocation.trim()) { setEvMsg("Title and location are required."); return; }
    const body = {
      title: evTitle.trim(), description: evDesc.trim(), date: evDate.trim(),
      time: evTime.trim(), location: evLocation.trim(), category: evCategory,
      sortOrder: Number(evSortOrder), basePoints: Number(evBasePoints),
      weight: Number(evWeight), firstPlaceBonus: Number(evFirstBonus),
      secondPlaceBonus: Number(evSecondBonus), thirdPlaceBonus: Number(evThirdBonus),
    };
    const url = evEditId ? `${apiBase}/admin/events/${evEditId}` : `${apiBase}/admin/events`;
    const method = evEditId ? "PUT" : "POST";
    const res = await fetch(url, { method, headers: adminHeaders, body: JSON.stringify(body) });
    const data = await res.json();
    if (res.ok) {
      setEvMsg(`✓ Event ${evEditId ? "updated" : "created"}`);
      clearEvForm();
      await fetchAdminEvents();
    } else {
      setEvMsg(`Error: ${data.error ?? "Unknown"}`);
    }
  };

  const deleteEvent = async (id: string) => {
    const res = await fetch(`${apiBase}/admin/events/${id}`, { method: "DELETE", headers: adminHeaders });
    if (res.ok || res.status === 204) { setEvMsg("✓ Event deleted"); await fetchAdminEvents(); }
    else setEvMsg("Delete failed");
  };

  const startEditEvent = (ev: typeof adminEvents[number]) => {
    setEvEditId(ev.id); setEvTitle(ev.title); setEvDesc(ev.description); setEvDate(ev.date);
    setEvTime(ev.time); setEvLocation(ev.location); setEvCategory(ev.category);
    setEvSortOrder(String(ev.sortOrder)); setEvBasePoints(String(ev.basePoints ?? 0));
    setEvWeight(String(ev.weight ?? 1)); setEvFirstBonus(String(ev.firstPlaceBonus ?? 0));
    setEvSecondBonus(String(ev.secondPlaceBonus ?? 0)); setEvThirdBonus(String(ev.thirdPlaceBonus ?? 0));
    setEvMsg(""); setResultsEventId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const recordResults = async () => {
    if (!resultsEventId) return;
    setResultsMsg("");
    const results: Array<{ teamId: string; place: number }> = [];
    if (resultsFirst.trim())  results.push({ teamId: resultsFirst.trim().toLowerCase(),  place: 1 });
    if (resultsSecond.trim()) results.push({ teamId: resultsSecond.trim().toLowerCase(), place: 2 });
    if (resultsThird.trim())  results.push({ teamId: resultsThird.trim().toLowerCase(),  place: 3 });
    const res = await fetch(`${apiBase}/admin/events/${resultsEventId}/results`, {
      method: "POST", headers: adminHeaders, body: JSON.stringify({ results }),
    });
    const data = await res.json();
    if (res.ok) {
      const placed = data.event?.results ?? [];
      const summary = placed.map((r: EventResult) => `${r.teamId} #${r.place} → +${r.pointsAwarded}pts`).join(", ");
      setResultsMsg(`✓ Recorded. ${summary}${data.errors?.length ? " | Errors: " + data.errors.join("; ") : ""}`);
      await fetchAdminEvents();
    } else {
      setResultsMsg(`Error: ${data.error ?? "Unknown"}`);
    }
  };

  // ── Bulk import helpers ───────────────────────────────────────
  const runBulkTeamImport = async (jsonText: string) => {
    setBulkTeamBusy(true); setBulkTeamMsg("");
    try {
      const parsed = JSON.parse(jsonText);
      const res = await fetch(`${apiBase}/admin/team-assignments/bulk`, {
        method: "POST", headers: adminHeaders,
        body: JSON.stringify({ teams: parsed, replace: bulkTeamReplace }),
      });
      const data = await res.json();
      if (res.ok) {
        const summary = Object.entries(data.results as Record<string, { added: string[]; captain?: string; errors: string[] }>)
          .map(([tid, r]) => `${tid.toUpperCase()}: ${r.added.length} added${r.captain ? `, captain=${r.captain}` : ""}${r.errors.length ? `, errors: ${r.errors.join("; ")}` : ""}`)
          .join("\n");
        setBulkTeamMsg("✓ Done\n" + summary);
        void fetchTeamAssignments();
      } else {
        setBulkTeamMsg("Error: " + (data.error ?? JSON.stringify(data)));
      }
    } catch (e) {
      setBulkTeamMsg("Parse error: " + String(e));
    } finally {
      setBulkTeamBusy(false);
    }
  };

  const runBulkEventsImport = async (jsonText: string) => {
    setBulkEvBusy(true); setBulkEvMsg("");
    try {
      const parsed = JSON.parse(jsonText);
      const events = Array.isArray(parsed) ? parsed : (parsed.events ?? parsed);
      const res = await fetch(`${apiBase}/admin/events/bulk`, {
        method: "POST", headers: adminHeaders,
        body: JSON.stringify({ events, replace: bulkEvReplace }),
      });
      const data = await res.json();
      if (res.ok) {
        setBulkEvMsg(`✓ Created ${data.created}, skipped ${data.skipped}`);
        void fetchAdminEvents();
      } else {
        setBulkEvMsg("Error: " + (data.error ?? JSON.stringify(data)));
      }
    } catch (e) {
      setBulkEvMsg("Parse error: " + String(e));
    } finally {
      setBulkEvBusy(false);
    }
  };

  const readFileAsText = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = () => reject(new Error("File read failed"));
      reader.readAsText(file);
    });

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
    await Promise.all([fetchReviewQueue(), fetchSecurityEvents(), fetchAuditLogs(), fetchLeaderboard(), fetchGameStatus(), fetchEventsList()]);
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

  // ── FIX 2: Restore player session from sessionStorage on mount ─
  useEffect(() => {
    if (mode !== "player") return;
    const saved = sessionStorage.getItem("scavenge_session");
    if (!saved) return;
    try {
      const { token, role: savedRole, teamId: savedTeamId } = JSON.parse(saved) as { token?: string; role?: string; teamId?: string };
      if (token && savedRole && savedTeamId) {
        setAuthToken(token);
        setRole(savedRole as Role);
        setTeamId(savedTeamId);
        void refreshTeamState(token);
      }
    } catch { /* corrupted */ }
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
    void fetchAdminEvents();
    void fetchPackingItems();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken, adminView, mode]);

  useEffect(() => {
    if (mode !== "admin" || !adminToken || adminView !== "live-ops") return;
    void loadAdminDashboard();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminToken, adminView, mode]);

  useEffect(() => {
    if (teamAssignments.length === 0) {
      return;
    }

    const selectedTeam = teamAssignments.find((team) => team.teamId === captainAssignmentTeamId) ?? teamAssignments[0];
    if (!selectedTeam) {
      return;
    }

    if (selectedTeam.teamId !== captainAssignmentTeamId) {
      setCaptainAssignmentTeamId(selectedTeam.teamId);
    }
    const rosterIncludesCaptain = selectedTeam.assignedParticipants.some(
      (name) => name.trim().toLowerCase() === selectedTeam.captainName.trim().toLowerCase()
    );
    const defaultCaptainName = rosterIncludesCaptain
      ? selectedTeam.captainName
      : (selectedTeam.assignedParticipants[0] ?? "");
    setCaptainAssignmentName(defaultCaptainName);
    setCaptainAssignmentPin(selectedTeam.captainPin);
  }, [captainAssignmentTeamId, teamAssignments]);

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

  // ── Player: clear verdict banner when a new clue becomes active ──────────
  useEffect(() => {
    if (mode !== "player") return;
    const currentClueIndex = teamState?.currentClueIndex;
    if (typeof currentClueIndex !== "number") return;

    if (lastSeenClueIndexRef.current !== null && lastSeenClueIndexRef.current !== currentClueIndex) {
      setLastVerdict(null);
      setLastFeedback("");
    }

    lastSeenClueIndexRef.current = currentClueIndex;
  }, [mode, teamState?.currentClueIndex]);

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
      headers: buildAdminMutationHeaders("team-deduct"),
      body: JSON.stringify({ amount, reason: deductReason })
    });

    if (!response.ok) {
      setStatusMessage(await parseError(response, "Deduction failed"));
      return;
    }

    setStatusMessage(`Deducted ${amount} points from ${deductTeamId}`);
    await Promise.all([fetchLeaderboard(), fetchAuditLogs()]);
  };

  const awardPoints = async (event: FormEvent) => {
    event.preventDefault();
    if (!awardTeamId.trim()) { setStatusMessage("Team ID is required"); return; }
    const amount = Number(awardAmount);
    if (!Number.isFinite(amount) || amount <= 0) { setStatusMessage("Amount must be a positive number"); return; }
    if (!awardReason.trim()) { setStatusMessage("Reason is required"); return; }
    const response = await fetch(`${apiBase}/admin/team/${awardTeamId.trim()}/award`, {
      method: "POST",
      headers: buildAdminMutationHeaders("team-award"),
      body: JSON.stringify({ amount, reason: awardReason.trim() })
    });
    if (!response.ok) { setStatusMessage(await parseError(response, "Award failed")); return; }
    setStatusMessage(`✓ Awarded ${amount} points to ${awardTeamId.trim()}`);
    setAwardReason("");
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
      headers: buildAdminMutationHeaders("clue-reopen"),
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

  const resetAllTeamsToClue1 = async () => {
    if (!window.confirm("Reset ALL teams to Clue 1? This cannot be undone.")) return;
    const results: string[] = [];
    for (const team of leaderboard) {
      const response = await fetch(`${apiBase}/admin/team/${team.teamId}/reopen-clue`, {
        method: "POST",
        headers: buildAdminMutationHeaders(`reset-clue1-${team.teamId}`),
        body: JSON.stringify({ clueIndex: 0, reason: "Admin reset all teams to Clue 1" })
      });
      results.push(response.ok ? `${team.teamId} ✓` : `${team.teamId} ✗`);
    }
    setStatusMessage(`Reset to Clue 1: ${results.join(", ")}`);
    await Promise.all([fetchLeaderboard(), fetchAuditLogs()]);
  };

  const moveTeamToPrevClue = async (teamId: string, currentClueIndex: number) => {
    const targetIndex = Math.max(0, currentClueIndex - 1);
    const response = await fetch(`${apiBase}/admin/team/${teamId}/reopen-clue`, {
      method: "POST",
      headers: buildAdminMutationHeaders(`prev-clue-${teamId}`),
      body: JSON.stringify({ clueIndex: targetIndex, reason: "Admin moved team back one clue" })
    });
    if (!response.ok) {
      setStatusMessage(await parseError(response, "Move back failed"));
      return;
    }
    setStatusMessage(`${teamId} moved to clue ${targetIndex + 1}`);
    await Promise.all([fetchLeaderboard(), fetchAuditLogs()]);
  };

  const skipTeamCurrentClue = async (teamId: string, currentClueIndex: number) => {
    const targetIndex = currentClueIndex + 1;
    const response = await fetch(`${apiBase}/admin/team/${teamId}/reopen-clue`, {
      method: "POST",
      headers: buildAdminMutationHeaders(`skip-clue-${teamId}`),
      body: JSON.stringify({ clueIndex: targetIndex, reason: "Admin skipped team forward one clue" })
    });
    if (!response.ok) {
      setStatusMessage(await parseError(response, "Skip forward failed"));
      return;
    }
    setStatusMessage(`${teamId} advanced to clue ${targetIndex + 1}`);
    await Promise.all([fetchLeaderboard(), fetchAuditLogs()]);
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

  const leaveHunt = () => {
    // FIX 2: clear sessionStorage
    sessionStorage.removeItem("scavenge_session");
    // FIX 3: clear localStorage revealed clue
    if (teamId) localStorage.removeItem(`scavenge_revealed_${teamId}`);
    setAuthToken("");
    setRole(null);
    setTeamId("");
    setTeamState(null);
    setLastVerdict(null);
    setLastFeedback("");
    setRevealedClueIndex(null);
    setSubmitText("");
    if (submitPreviewUrl) URL.revokeObjectURL(submitPreviewUrl);
    setSubmitFile(null);
    setSubmitPreviewUrl(null);
    setIsSubmitting(false);
    setVerdictReveal(null);
    setAdminHint(null);
    setBroadcastMsg(null);
    // FIX 5: clear skip confirm pending
    setSkipConfirmPending(false);
    setStatusMessage("Ready");
  };

  return (
    <ErrorBoundary>
    <div className={mode === "player" ? "" : "container"}>
      {mode === "admin" && <h1>SCAVENGE Admin</h1>}
      {mode === "admin" && <p className="status">Status: {statusMessage}</p>}

      {mode === "player" && (
        <div className="player-app">
          {!authToken ? (
            /* ── Join Screen ──────────────────────────────────── */
            <div className="join-screen">
              <button className="join-home-btn" onClick={() => window.location.href = "/"}>← Home</button>
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
              {gameStatus?.joinLocked && gameStatus?.status !== "ENDED" && (
                <div className="game-ended-banner">🔒 Entry is currently locked — check back soon</div>
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
                        setMemberJoinConfirmed(false);
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
                        onClick={() => { setDisplayName(participantName); setMemberJoinConfirmed(false); }}
                      >
                        {participantName}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="empty-roster-note">No players are assigned to this team yet. Ask the Dictator to add you first.</div>
                )}
                {gameStatus?.testMode && gameStatus?.status !== "ENDED" ? (
                  <div className="test-mode-banner">🧪 Test Mode — PIN skipped, everyone joins as captain</div>
                ) : (
                  <>
                    <label className="field-label">
                      Captain PIN <span className="field-optional">(captains only — leave blank if member)</span>
                    </label>
                    <input
                      data-testid="captain-pin-input"
                      className="join-input"
                      type="password"
                      inputMode="numeric"
                      value={captainPin}
                      onChange={(e) => { setCaptainPin(e.target.value); setMemberJoinConfirmed(false); }}
                      placeholder="6-digit PIN"
                    />
                  </>
                )}
                <button data-testid="join-submit-btn" className="join-btn" type="submit" disabled={!displayName}>Join Hunt →</button>
              </form>

              {statusMessage && statusMessage !== "Ready" && (
                <p data-testid="join-status-message" className={memberJoinConfirmed ? "join-warning" : "join-error"}>{statusMessage}</p>
              )}
            </div>
          ) : (
            /* ── In-Game Screen ───────────────────────────────── */
            <div className="game-screen">
              {/* Offline banner */}
              {!socketConnected && (
                <div className="offline-banner">⚠️ Reconnecting… some updates may be delayed</div>
              )}

              {statusMessage && statusMessage !== "Ready" && (
                <div data-testid="player-status-message" className="player-status-banner">{statusMessage}</div>
              )}

              {/* Header */}
              <header data-testid="player-header" className="player-header">
                <button className="btn-leave-hunt" onClick={leaveHunt} title="Return to home screen">← Home</button>
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
                    style={{ width: `${Math.min(100, ((teamState?.completedCount ?? 0) / (teamState?.clueCount ?? 14)) * 100)}%` }}
                  />
                </div>
                <div className="progress-meta">
                  Clue {(teamState?.currentClueIndex ?? 0) + 1} of {teamState?.clueCount ?? 14}
                  &nbsp;·&nbsp; {teamState?.completedCount ?? 0} solved
                  &nbsp;·&nbsp; {teamState?.skippedCount ?? 0} skipped
                  {clueElapsed && <>&nbsp;·&nbsp; ⏱ {clueElapsed}</>}
                  &nbsp;·&nbsp;
                  <span className={(teamState?.completedCount ?? 0) >= (teamState?.minCluesForEligibility ?? 9) ? "eligible" : "ineligible"}>
                    {(teamState?.completedCount ?? 0) >= (teamState?.minCluesForEligibility ?? 9) ? "✅ Eligible" : `⚠️ Need ${teamState?.minCluesForEligibility ?? 9} to qualify`}
                  </span>
                </div>
              </div>

              {/* Tab bar */}
              <div className="player-tabs">
                <button
                  className={`player-tab${playerTab === "clue" ? " player-tab--active" : ""}`}
                  onClick={() => { setPlayerTab("clue"); }}
                >🗺️ Clue</button>
                <button
                  className={`player-tab${playerTab === "leaderboard" ? " player-tab--active" : ""}`}
                  onClick={() => { setPlayerTab("leaderboard"); void fetchLeaderboard(); }}
                >🏆 Standings</button>
              </div>

              {/* ── Clue tab ─────────────────────────────────── */}
              {playerTab === "clue" && (
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
                  ) : gameStatus?.status === "ENDED" ? (
                    <div className="waiting-room waiting-room--ended">
                      <div className="waiting-icon">🏁</div>
                      <h2 className="waiting-title">Hunt over!</h2>
                      <p className="waiting-body">The hunt has ended. Check the standings to see your final result.</p>
                      <button className="btn-refresh" onClick={() => { setPlayerTab("leaderboard"); void fetchLeaderboard(); }}>🏆 Final Standings</button>
                    </div>
                  ) : (() => {
                    const currentClueState = teamState?.clueStates?.[teamState?.currentClueIndex];
                    const isCurrentClueFinished = currentClueState?.status === "COMPLETED" || currentClueState?.status === "PASSED";
                    return isCurrentClueFinished;
                  })() ? (
                    <div className="waiting-room waiting-room--complete">
                      <div className="waiting-icon">🎉</div>
                      <h2 className="waiting-title">All clues done!</h2>
                      <p className="waiting-body">You've completed all your clues — great work! Head to the final checkpoint and check the standings.</p>
                      <button className="btn-refresh" onClick={() => { setPlayerTab("leaderboard"); void fetchLeaderboard(); }}>🏆 View Standings</button>
                      <button className="btn-refresh" style={{ marginTop: "0.5rem" }} onClick={() => { void refreshTeamState(); void fetchGameStatus(); }}>🔄 Refresh</button>
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

                          {/* Verdict (FIX 10: dismiss button) */}
                          {lastVerdict && (
                            <div className={`verdict-banner verdict--${lastVerdict === "NEEDS_REVIEW" ? "needs-review" : lastVerdict.toLowerCase()}`}>
                              <button className="verdict-dismiss" onClick={() => { setLastVerdict(null); setLastFeedback(""); }}>✕</button>
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
                              {/* FIX 5: Skip confirmation dialog */}
                              {skipConfirmPending && (
                                <div className="skip-confirm-overlay">
                                  <div className="skip-confirm-dialog">
                                    <p className="skip-confirm-title">Skip this clue?</p>
                                    <p className="skip-confirm-body">
                                      This uses 1 of your {5 - (teamState?.skippedCount ?? 0)} remaining passes. You cannot undo a skip.
                                    </p>
                                    <div className="skip-confirm-actions">
                                      <button className="btn-skip-yes" onClick={() => { setSkipConfirmPending(false); void passClue(); }}>
                                        Yes, skip it
                                      </button>
                                      <button className="btn-skip-cancel" onClick={() => setSkipConfirmPending(false)}>
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              )}
                              <div className="submit-actions">
                                <button
                                  className="btn-submit"
                                  onClick={() => { void submitClue(); }}
                                  disabled={
                                    isSubmitting ||
                                    !submitText.trim() ||
                                    (teamState.currentClue.submission_type === "PHOTO" && !submitFile)
                                  }
                                >
                                  {isSubmitting ? (uploadProgress || "Submitting…") : "Submit Answer ✓"}
                                </button>
                                {!teamState.currentClue.required_flag && (
                                  <button
                                    className="btn-pass"
                                    onClick={() => setSkipConfirmPending(true)}
                                    disabled={isSubmitting || (teamState.skippedCount ?? 0) >= 5}
                                  >Skip this clue</button>
                                )}
                              </div>
                              {/* FIX 11: Upload progress bar */}
                              {isSubmitting && (
                                <div className="upload-progress-bar">
                                  <div className="upload-progress-fill" />
                                </div>
                              )}
                              <div className="passes-counter">
                                {teamState.skippedCount ?? 0} of 5 skips used
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
              {playerTab === "leaderboard" && (
                <div className="leaderboard-panel">
                  <div className="lb-heading">Live Standings</div>
                  <button className="btn-leave-hunt btn-leave-hunt--secondary" onClick={leaveHunt}>← Home</button>
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
                        <li>Each clue awards points based on accuracy.</li>
                        <li>You can pass up to <strong>5 optional clues</strong> — REQUIRED clues cannot be passed.</li>
                        <li>You must complete at least <strong>9 clues</strong> to be eligible to win.</li>
                        <li>Final score on the leaderboard determines the winner.</li>
                      </ul>
                    </div>
                  </>
                )}

                {infoModal === "rules" && (
                  <>
                    <h2 className="info-title">📋 Rules</h2>
                    <div className="info-body">
                      <ol>
                        <li>Each team has exactly <strong>one captain</strong>. Only the captain can reveal clues, submit answers, or pass clues.</li>
                        <li>You may pass up to <strong>5 optional clues</strong>. <strong>REQUIRED clues cannot be passed.</strong></li>
                        <li>You must complete at least <strong>9 clues</strong> to be eligible to win.</li>
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
                        <div className="faq-a">Tap your team, then choose your assigned name from the list for that team. If your name is missing, contact the Dictator.{!gameStatus?.testMode && " Captains still enter their 6-digit PIN."}</div>
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

          {!adminToken && (
            <div className="admin-login-required">🔒 Log in above to manage team assignments and game operations.</div>
          )}

          <div className="tabs admin-tabs">
            <button onClick={() => setAdminView("setup")} className={adminView === "setup" ? "active" : ""}>Setup</button>
            <button onClick={() => setAdminView("live-ops")} className={adminView === "live-ops" ? "active" : ""}>Live Ops</button>
          </div>

          {adminView === "setup" && adminToken && (
            <>
              <h3>Team Assignments</h3>
              <form onSubmit={assignParticipantToTeam} className="panel">
                <select
                  data-testid="participant-team-select"
                  value={assignmentTeamId}
                  onChange={(event) => setAssignmentTeamId(event.target.value)}
                >
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
                  <button data-testid="assign-participant-button" type="submit">Assign To Team</button>
                  <button type="button" onClick={() => { void fetchTeamAssignments(); }}>Refresh Assignments</button>
                </div>
              </form>

              <h3>Captain Assignment</h3>
              <form onSubmit={assignCaptainToTeam} className="panel">
                <select
                  data-testid="captain-team-select"
                  value={captainAssignmentTeamId}
                  onChange={(event) => setCaptainAssignmentTeamId(event.target.value)}
                >
                  {TEAM_SUIT_OPTIONS.map((team) => (
                    <option key={team} value={team.toLowerCase()}>{team}</option>
                  ))}
                </select>
                <select
                  data-testid="captain-name-input"
                  value={captainAssignmentName}
                  onChange={(event) => setCaptainAssignmentName(event.target.value)}
                >
                  <option value="">Select assigned participant</option>
                  {captainAssignmentRoster.map((participantName) => (
                    <option key={`${captainAssignmentTeamId}-${participantName}`} value={participantName}>
                      {participantName}
                    </option>
                  ))}
                </select>
                <input
                  data-testid="captain-pin-admin-input"
                  value={captainAssignmentPin}
                  onChange={(event) => setCaptainAssignmentPin(event.target.value)}
                  placeholder="Captain PIN (6 digits)"
                  inputMode="numeric"
                  maxLength={6}
                />
                <label>
                  <input
                    data-testid="captain-force-override-toggle"
                    type="checkbox"
                    checked={captainAssignmentForceOverride}
                    onChange={(event) => setCaptainAssignmentForceOverride(event.target.checked)}
                  />
                  Allow reassignment while RUNNING (force override)
                </label>
                {captainAssignmentRoster.length === 0 && (
                  <div className="assignment-empty">Assign a participant to this team before setting captain.</div>
                )}
                <div className="actions-row">
                  <button data-testid="assign-captain-button" type="submit" disabled={captainAssignmentRoster.length === 0}>Assign Captain + PIN</button>
                  <button type="button" onClick={() => { void fetchTeamAssignments(); }}>Refresh Captains</button>
                </div>
              </form>

              <div className="assignment-grid">
                {teamAssignments.map((team) => (
                  <div key={team.teamId} className="assignment-card">
                    <div className="assignment-card__title">{team.teamName}</div>
                    <div className="assignment-card__meta">Captain: {team.captainName}</div>
                    <div className="assignment-card__meta">Captain PIN: {team.captainPin}</div>
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

              {/* ── Bulk Team Import ─────────────────────────── */}
              <h3>Bulk Team Import</h3>
              <div className="panel bulk-import-panel">
                <p className="bulk-hint">
                  Paste JSON or upload a file. Format:
                  <button className="btn-template" onClick={() => setBulkTeamJson(JSON.stringify({
                    spades:   { members: ["Lars","Name2","Name3","Name4"],   captain: "Lars",  pin: "123456" },
                    hearts:   { members: ["Carl","Name2","Name3","Name4"],   captain: "Carl",  pin: "234567" },
                    diamonds: { members: ["Rich","Name2","Name3","Name4"],   captain: "Rich",  pin: "345678" },
                    clubs:    { members: ["Dave","Name2","Name3","Name4"],   captain: "Dave",  pin: "456789" },
                  }, null, 2))}>Load template</button>
                </p>
                <textarea
                  className="bulk-textarea"
                  value={bulkTeamJson}
                  onChange={(e) => setBulkTeamJson(e.target.value)}
                  placeholder='{ "spades": { "members": ["Lars","Bob"], "captain": "Lars", "pin": "123456" }, ... }'
                  rows={8}
                />
                <div className="bulk-actions">
                  <label className="bulk-file-label">
                    Upload JSON file
                    <input type="file" accept=".json,application/json" style={{ display: "none" }}
                      onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const txt = await readFileAsText(f); setBulkTeamJson(txt); } }} />
                  </label>
                  <label className="bulk-checkbox">
                    <input type="checkbox" checked={bulkTeamReplace} onChange={(e) => setBulkTeamReplace(e.target.checked)} />
                    Replace existing members
                  </label>
                  <button onClick={() => { void runBulkTeamImport(bulkTeamJson); }} disabled={bulkTeamBusy || !bulkTeamJson.trim()}>
                    {bulkTeamBusy ? "Importing…" : "Import Teams"}
                  </button>
                </div>
                {bulkTeamMsg && <pre className="bulk-result">{bulkTeamMsg}</pre>}
              </div>

              {/* ── Packing List Management ──────────────────── */}
              <h3>What to Bring <button style={{ fontSize: "0.75rem", marginLeft: "0.5rem" }} onClick={() => { void fetchPackingItems(); }}>Refresh</button></h3>
              <div className="panel admin-events-form">
                <div className="admin-events-fields">
                  <input placeholder="Item text *" value={pkText} onChange={(e) => setPkText(e.target.value)} style={{ gridColumn: "1 / -1" }} />
                  <input placeholder="Note (optional)" value={pkNote} onChange={(e) => setPkNote(e.target.value)} style={{ gridColumn: "1 / -1" }} />
                  <select value={pkCategory} onChange={(e) => setPkCategory(e.target.value)}>
                    <option value="clothing">👕 Clothing</option>
                    <option value="gear">🎒 Gear &amp; Accessories</option>
                    <option value="documents">📄 Documents &amp; IDs</option>
                    <option value="health">💊 Health &amp; Toiletries</option>
                    <option value="other">📦 Other</option>
                  </select>
                  <input type="number" placeholder="Sort order" value={pkSortOrder} onChange={(e) => setPkSortOrder(e.target.value)} style={{ width: "80px" }} />
                </div>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                  <button onClick={() => { void savePkItem(); }}>{pkEditId ? "Update Item" : "Add Item"}</button>
                  {pkEditId && <button onClick={clearPkForm}>Cancel</button>}
                </div>
                {pkMsg && <p style={{ marginTop: "0.4rem", color: pkMsg.startsWith("✓") ? "#4ade80" : "#f87171" }}>{pkMsg}</p>}
              </div>
              {packingItems.length === 0 && <p style={{ color: "#94a3b8" }}>No packing items yet. Add one above.</p>}
              <ul className="list" style={{ marginTop: "0.5rem" }}>
                {packingItems.map((item) => (
                  <li key={item.id} className="ev-list-item">
                    <div className="ev-list-info">
                      <strong>{item.text}</strong>
                      <span style={{ color: "#94a3b8", fontSize: "0.85rem" }}> · {item.category}</span>
                      {item.note && <span style={{ color: "#94a3b8", fontSize: "0.85rem" }}> · {item.note}</span>}
                    </div>
                    <div className="ev-list-actions">
                      <button onClick={() => startEditPkItem(item)}>Edit</button>
                      <button className="btn-danger" onClick={() => { if (window.confirm(`Remove "${item.text}"?`)) void deletePkItem(item.id); }}>Del</button>
                    </div>
                  </li>
                ))}
              </ul>

              {/* ── Events Management ────────────────────────── */}
              <h3>Events</h3>
              <div className="panel admin-events-form">
                <div className="admin-events-fields">
                  <input placeholder="Event title *" value={evTitle} onChange={(e) => setEvTitle(e.target.value)} style={{ gridColumn: "1 / -1" }} />
                  <input placeholder="Description" value={evDesc} onChange={(e) => setEvDesc(e.target.value)} style={{ gridColumn: "1 / -1" }} />
                  <input type="date" value={evDate} onChange={(e) => setEvDate(e.target.value)} />
                  <input type="time" placeholder="Time (HH:MM)" value={evTime} onChange={(e) => setEvTime(e.target.value)} />
                  <input placeholder="Location *" value={evLocation} onChange={(e) => setEvLocation(e.target.value)} />
                  <select value={evCategory} onChange={(e) => setEvCategory(e.target.value)}>
                    <option value="hunt">🗺️ Hunt</option>
                    <option value="meal">🍽️ Meal</option>
                    <option value="activity">🎯 Activity</option>
                    <option value="transport">🚗 Transport</option>
                    <option value="other">📌 Other</option>
                  </select>
                  <input type="number" placeholder="Sort order" value={evSortOrder} onChange={(e) => setEvSortOrder(e.target.value)} style={{ width: "80px" }} />
                </div>
                <div className="ev-scoring-row">
                  <label className="ev-scoring-label">Base pts<input type="number" min="0" value={evBasePoints} onChange={(e) => setEvBasePoints(e.target.value)} /></label>
                  <label className="ev-scoring-label">Weight<input type="number" min="0.1" step="0.1" value={evWeight} onChange={(e) => setEvWeight(e.target.value)} /></label>
                  <span className="ev-scoring-sep">Placement bonuses:</span>
                  <label className="ev-scoring-label">🥇 1st<input type="number" min="0" value={evFirstBonus} onChange={(e) => setEvFirstBonus(e.target.value)} /></label>
                  <label className="ev-scoring-label">🥈 2nd<input type="number" min="0" value={evSecondBonus} onChange={(e) => setEvSecondBonus(e.target.value)} /></label>
                  <label className="ev-scoring-label">🥉 3rd<input type="number" min="0" value={evThirdBonus} onChange={(e) => setEvThirdBonus(e.target.value)} /></label>
                  <span className="ev-scoring-preview">
                    Effective: 🥇 {Math.round(Number(evBasePoints||0)*Number(evWeight||1)+Number(evFirstBonus||0))}
                    · 🥈 {Math.round(Number(evBasePoints||0)*Number(evWeight||1)+Number(evSecondBonus||0))}
                    · 🥉 {Math.round(Number(evBasePoints||0)*Number(evWeight||1)+Number(evThirdBonus||0))} pts
                  </span>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                  <button onClick={() => { void saveEvent(); }}>{evEditId ? "Update Event" : "Add Event"}</button>
                  {evEditId && <button onClick={clearEvForm}>Cancel</button>}
                  <button type="button" style={{ marginLeft: "auto" }} onClick={() => { void fetchAdminEvents(); }}>Refresh</button>
                </div>
                {evMsg && <p style={{ marginTop: "0.4rem", color: evMsg.startsWith("✓") ? "#4ade80" : "#f87171" }}>{evMsg}</p>}
              </div>
              {adminEvents.length === 0 && <p style={{ color: "#94a3b8" }}>No events yet. Add one above or bulk import below.</p>}
              <ul className="list" style={{ marginTop: "0.5rem" }}>
                {adminEvents.map((ev) => {
                  const eff1 = Math.round(ev.basePoints * ev.weight + ev.firstPlaceBonus);
                  const eff2 = Math.round(ev.basePoints * ev.weight + ev.secondPlaceBonus);
                  const eff3 = Math.round(ev.basePoints * ev.weight + ev.thirdPlaceBonus);
                  const hasScoring = ev.basePoints > 0 || ev.firstPlaceBonus > 0;
                  const placed = ev.results ?? [];
                  return (
                    <li key={ev.id} className="ev-list-item">
                      <div className="ev-list-info">
                        <strong>{ev.title}</strong> · {ev.date} {ev.time && `@ ${ev.time}`}
                        {hasScoring && <span className="ev-pts-badge">🥇{eff1} 🥈{eff2} 🥉{eff3} pts</span>}
                        <br />
                        <span style={{ color: "#94a3b8", fontSize: "0.85rem" }}>📍 {ev.location} · {ev.category}{ev.weight !== 1 ? ` · ×${ev.weight} weight` : ""}</span>
                        {ev.description && <span style={{ color: "#94a3b8", fontSize: "0.85rem" }}> · {ev.description}</span>}
                        {placed.length > 0 && (
                          <div className="ev-results-summary">
                            {placed.map((r) => <span key={r.teamId} className="ev-result-pill">#{r.place} {r.teamId.toUpperCase()} +{r.pointsAwarded}pts</span>)}
                          </div>
                        )}
                      </div>
                      <div className="ev-list-actions">
                        <button onClick={() => startEditEvent(ev)}>Edit</button>
                        <button onClick={() => { setResultsEventId(ev.id === resultsEventId ? null : ev.id); setResultsFirst(""); setResultsSecond(""); setResultsThird(""); setResultsMsg(""); }}>
                          {ev.id === resultsEventId ? "Cancel" : "Results"}
                        </button>
                        <button className="btn-danger" onClick={() => { if (window.confirm(`Delete "${ev.title}"?`)) void deleteEvent(ev.id); }}>Del</button>
                      </div>
                      {resultsEventId === ev.id && (
                        <div className="ev-results-panel">
                          <div className="ev-results-row">
                            <label>🥇 1st team<select value={resultsFirst} onChange={(e) => setResultsFirst(e.target.value)}><option value="">—</option>{["spades","hearts","diamonds","clubs"].map((t) => <option key={t} value={t}>{t.toUpperCase()} (+{Math.round(ev.basePoints * ev.weight + ev.firstPlaceBonus)}pts)</option>)}</select></label>
                            <label>🥈 2nd team<select value={resultsSecond} onChange={(e) => setResultsSecond(e.target.value)}><option value="">—</option>{["spades","hearts","diamonds","clubs"].map((t) => <option key={t} value={t}>{t.toUpperCase()} (+{Math.round(ev.basePoints * ev.weight + ev.secondPlaceBonus)}pts)</option>)}</select></label>
                            <label>🥉 3rd team<select value={resultsThird} onChange={(e) => setResultsThird(e.target.value)}><option value="">—</option>{["spades","hearts","diamonds","clubs"].map((t) => <option key={t} value={t}>{t.toUpperCase()} (+{Math.round(ev.basePoints * ev.weight + ev.thirdPlaceBonus)}pts)</option>)}</select></label>
                          </div>
                          <button onClick={() => { void recordResults(); }}>Save Results &amp; Award Points</button>
                          {resultsMsg && <p style={{ color: resultsMsg.startsWith("✓") ? "#4ade80" : "#f87171", fontSize: "0.82rem", marginTop: "0.3rem" }}>{resultsMsg}</p>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              {/* ── Bulk Events Import ───────────────────────── */}
              <h3>Bulk Events Import</h3>
              <div className="panel bulk-import-panel">
                <p className="bulk-hint">
                  Paste a JSON array or upload a file.
                  <button className="btn-template" onClick={() => setBulkEvJson(JSON.stringify([
                    { title: "Scavenger Hunt Start", date: "2026-04-11", time: "10:00", location: "Zephyr Hotel, Pier 39", category: "hunt", description: "Gather at lobby", sortOrder: 1, basePoints: 0, weight: 1, firstPlaceBonus: 500, secondPlaceBonus: 300, thirdPlaceBonus: 100 },
                    { title: "Lunch at Pier Market",  date: "2026-04-11", time: "13:00", location: "Pier 39 Marketplace",  category: "meal", description: "", sortOrder: 5, basePoints: 0, weight: 1, firstPlaceBonus: 0, secondPlaceBonus: 0, thirdPlaceBonus: 0 },
                    { title: "Waymo to Lombard St",   date: "2026-04-11", time: "14:00", location: "1083 Lombard Street",  category: "transport", description: "Required clue", sortOrder: 8, basePoints: 0, weight: 1, firstPlaceBonus: 0, secondPlaceBonus: 0, thirdPlaceBonus: 0 },
                    { title: "Final Standings",       date: "2026-04-11", time: "17:00", location: "Buena Vista Bar",      category: "activity", description: "Overall finish", sortOrder: 12, basePoints: 0, weight: 1, firstPlaceBonus: 1000, secondPlaceBonus: 500, thirdPlaceBonus: 250 },
                  ], null, 2))}>Load template</button>
                </p>
                <textarea
                  className="bulk-textarea"
                  value={bulkEvJson}
                  onChange={(e) => setBulkEvJson(e.target.value)}
                  placeholder='[{ "title": "Event", "date": "2026-04-11", "time": "10:00", "location": "...", "category": "hunt" }]'
                  rows={8}
                />
                <div className="bulk-actions">
                  <label className="bulk-file-label">
                    Upload JSON file
                    <input type="file" accept=".json,application/json" style={{ display: "none" }}
                      onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const txt = await readFileAsText(f); setBulkEvJson(txt); } }} />
                  </label>
                  <label className="bulk-checkbox">
                    <input type="checkbox" checked={bulkEvReplace} onChange={(e) => setBulkEvReplace(e.target.checked)} />
                    Replace all existing events
                  </label>
                  <button onClick={() => { void runBulkEventsImport(bulkEvJson); }} disabled={bulkEvBusy || !bulkEvJson.trim()}>
                    {bulkEvBusy ? "Importing…" : "Import Events"}
                  </button>
                </div>
                {bulkEvMsg && <p className="bulk-result" style={{ color: bulkEvMsg.startsWith("✓") ? "#4ade80" : "#f87171" }}>{bulkEvMsg}</p>}
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

          {adminView === "live-ops" && adminToken && (
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
              Current: <strong data-testid="game-status-label">{gameStatus?.status ?? "-"}</strong>
            </p>
            <p>
              Game: {gameStatus?.name ?? "-"} ({gameStatus?.timezone ?? "-"})
            </p>

            <div className="hunt-mode-controls">
              <div className="hunt-mode-btn-group">
                <button
                  data-testid="btn-start-test"
                  className="hunt-mode-btn hunt-mode-btn--test"
                  onClick={() => { void startTestHunt(); }}
                  disabled={adminStartTestBusy || adminStartProdBusy || adminEndHuntBusy}
                >
                  {adminStartTestBusy ? "Starting…" : "🧪 Enable Test Mode"}
                </button>
                <p className="hunt-mode-desc">Loads test clues, resets all progress, starts the hunt.</p>
              </div>

              <div className="hunt-mode-btn-group">
                <button
                  data-testid="btn-start-production"
                  className="hunt-mode-btn hunt-mode-btn--production"
                  onClick={() => { void startProductionHunt(); }}
                  disabled={adminStartTestBusy || adminStartProdBusy || adminEndHuntBusy}
                >
                  {adminStartProdBusy ? "Starting…" : "🏁 Enable Production Mode"}
                </button>
                <p className="hunt-mode-desc">Loads real clues, resets all progress, starts the hunt.</p>
              </div>

              <div className="hunt-mode-btn-group">
                <button
                  data-testid="btn-end-hunt"
                  className="hunt-mode-btn hunt-mode-btn--end"
                  onClick={() => { void endHunt(); }}
                  disabled={adminStartTestBusy || adminStartProdBusy || adminEndHuntBusy}
                >
                  {adminEndHuntBusy ? "Updating…" : gameStatus?.status === "ENDED" ? "▶️ Turn Hunt Back On" : "🛑 Turn Off Hunt"}
                </button>
                <p className="hunt-mode-desc">{gameStatus?.status === "ENDED" ? "Sets game back to RUNNING. Teams can submit again." : "Sets game to ENDED. All submissions are locked."}</p>
              </div>

              <div className="hunt-mode-btn-group">
                <button
                  data-testid="btn-join-lock"
                  className={`hunt-mode-btn ${gameStatus?.joinLocked ? "hunt-mode-btn--production" : "hunt-mode-btn--end"}`}
                  onClick={() => { void toggleJoinLock(); }}
                  disabled={joinLockBusy}
                >
                  {joinLockBusy ? "Updating…" : gameStatus?.joinLocked ? "🔓 Unlock Entry" : "🔒 Lock Entry"}
                </button>
                <p className="hunt-mode-desc">{gameStatus?.joinLocked ? "Entry is locked — no new players can join." : "Entry is open — players can join."}</p>
              </div>
            </div>

            <div className="actions-row" style={{ marginTop: "1rem" }}>
              <button onClick={() => updateGameStatus("PENDING")}>Set Pending</button>
              <button onClick={() => updateGameStatus("PAUSED")}>Pause</button>
            </div>
            <div className="actions-row" style={{ marginTop: "0.5rem" }}>
              <button
                className="btn-danger"
                onClick={() => { void resetAllTeamsToClue1(); }}
                disabled={leaderboard.length === 0}
              >
                ⏮ Reset ALL teams to Clue 1
              </button>
            </div>
          </div>

          <h3>Event Results</h3>
          <div className="panel">
            <button onClick={() => { void fetchEventsList(); }}>Refresh Events</button>
            {eventsList.length === 0 && <p style={{ color: "#64748b", fontSize: "0.85rem" }}>No scored events found.</p>}
            {eventsList.map((ev) => {
              const teamPts = eventResults[ev.id] ?? {};
              const TEAM_LABELS: Record<string, string> = { spades: "♠ Spades", hearts: "♥ Hearts", diamonds: "♦ Diamonds", clubs: "♣ Clubs" };
              return (
                <div key={ev.id} style={{ marginBottom: "1.25rem", paddingBottom: "1rem", borderBottom: "1px solid #1e293b" }}>
                  <p style={{ fontWeight: 700, color: "#f1f5f9", marginBottom: "0.5rem" }}>
                    {ev.title} <span style={{ color: "#64748b", fontWeight: 400, fontSize: "0.8rem" }}>{ev.date}</span>
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0.5rem", marginBottom: "0.5rem" }}>
                    {EVENT_TEAMS.map(t => (
                      <div key={t}>
                        <label style={{ fontSize: "0.72rem", color: "#94a3b8", display: "block", marginBottom: "0.2rem" }}>{TEAM_LABELS[t]}</label>
                        <input
                          type="number"
                          min="0"
                          value={teamPts[t] ?? "0"}
                          onChange={e => setEventResults(r => ({ ...r, [ev.id]: { ...r[ev.id] ?? {}, [t]: e.target.value } }))}
                          style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0", borderRadius: "4px", padding: "0.3rem", boxSizing: "border-box" as const }}
                        />
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => { void submitEventResult(ev.id); }}
                    disabled={eventResultBusy[ev.id]}
                    style={{ background: "#3b82f6", border: "none", borderRadius: "4px", color: "#fff", padding: "0.3rem 0.8rem", cursor: "pointer", fontSize: "0.85rem" }}
                  >
                    {eventResultBusy[ev.id] ? "Saving…" : "Save Results"}
                  </button>
                  {eventResultMsg[ev.id] && (
                    <span style={{ marginLeft: "0.75rem", fontSize: "0.8rem", color: eventResultMsg[ev.id]?.startsWith("✓") ? "#4ade80" : "#f87171" }}>
                      {eventResultMsg[ev.id]}
                    </span>
                  )}
                </div>
              );
            })}
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
                {item.textContent && (
                  <div className="review-text-answer">📝 {item.textContent}</div>
                )}
                {item.mediaUrl && (
                  <div className="review-photo">
                    <a href={item.mediaUrl} target="_blank" rel="noopener noreferrer">
                      <img src={item.mediaUrl} alt="Submission" className="review-photo-img" />
                    </a>
                  </div>
                )}
                {item.aiReasons && item.aiReasons.length > 0 && (
                  <div className="review-ai-feedback">
                    🤖 AI score: {item.aiScore ?? "—"} — {item.aiReasons.join("; ")}
                  </div>
                )}
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

          <h3>Award / Deduct Points</h3>
          <div className="panel points-adjust-panel">
            <div className="points-adjust-toggle">
              <button
                type="button"
                className={pointsAdjustMode === "award" ? "points-toggle-btn active-award" : "points-toggle-btn"}
                onClick={() => setPointsAdjustMode("award")}
              >+ Award</button>
              <button
                type="button"
                className={pointsAdjustMode === "deduct" ? "points-toggle-btn active-deduct" : "points-toggle-btn"}
                onClick={() => setPointsAdjustMode("deduct")}
              >− Deduct</button>
            </div>
            {pointsAdjustMode === "award" ? (
              <form onSubmit={awardPoints} style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.75rem" }}>
                <select value={awardTeamId} onChange={(e) => setAwardTeamId(e.target.value)}>
                  <option value="">Select team…</option>
                  <option value="spades">♠ Spades</option>
                  <option value="hearts">♥ Hearts</option>
                  <option value="diamonds">♦ Diamonds</option>
                  <option value="clubs">♣ Clubs</option>
                </select>
                <input type="number" min="1" value={awardAmount} onChange={(e) => setAwardAmount(e.target.value)} placeholder="Points to award" />
                <input value={awardReason} onChange={(e) => setAwardReason(e.target.value)} placeholder="Reason (required)" />
                <button type="submit" className="btn-award">Award Points</button>
              </form>
            ) : (
              <form onSubmit={deductPoints} style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.75rem" }}>
                <select value={deductTeamId} onChange={(event) => setDeductTeamId(event.target.value)}>
                  <option value="">Select team…</option>
                  <option value="spades">♠ Spades</option>
                  <option value="hearts">♥ Hearts</option>
                  <option value="diamonds">♦ Diamonds</option>
                  <option value="clubs">♣ Clubs</option>
                </select>
                <input type="number" min="1" value={deductAmount} onChange={(event) => setDeductAmount(event.target.value)} placeholder="Points to deduct" />
                <input value={deductReason} onChange={(event) => setDeductReason(event.target.value)} placeholder="Reason (required)" />
                <button type="submit" className="btn-danger">Deduct Points</button>
              </form>
            )}
          </div>

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
              <li key={item.teamId} style={{ gridTemplateColumns: "1fr" }}>
                <div style={{ fontWeight: 700, color: "#f1f5f9" }}>
                  {item.teamName} &nbsp;·&nbsp; {item.scoreTotal} pts &nbsp;·&nbsp; Clue {item.currentClueIndex + 1}
                </div>
                <div className="actions-row" style={{ marginTop: "0.4rem" }}>
                  <button onClick={() => loadTeamContext(item.teamId, item.currentClueIndex)}>
                    Load Context
                  </button>
                  <button
                    title="Move this team back one clue"
                    disabled={item.currentClueIndex === 0}
                    onClick={() => { void moveTeamToPrevClue(item.teamId, item.currentClueIndex); }}
                  >
                    ◀ Prev Clue
                  </button>
                  <button
                    title="Skip this team forward one clue"
                    onClick={() => { void skipTeamCurrentClue(item.teamId, item.currentClueIndex); }}
                  >
                    Skip Clue ▶
                  </button>
                  <button
                    title="Reopen current clue (sets it back to ACTIVE)"
                    onClick={() => {
                      setReopenTeamId(item.teamId);
                      setReopenClueIndex(String(item.currentClueIndex));
                      setStatusMessage(`Reopen form loaded for ${item.teamId} clue ${item.currentClueIndex + 1}`);
                    }}
                  >
                    Reopen Clue
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {/* ── Events Management ──────────────────────────────────── */}
          <h3>Website Events <button style={{ fontSize: "0.75rem", marginLeft: "0.5rem" }} onClick={() => { void fetchAdminEvents(); }}>Refresh</button></h3>
          <div className="panel admin-events-form">
            <div className="admin-events-fields">
              <input placeholder="Event title *" value={evTitle} onChange={(e) => setEvTitle(e.target.value)} style={{ gridColumn: "1 / -1" }} />
              <input placeholder="Description" value={evDesc} onChange={(e) => setEvDesc(e.target.value)} style={{ gridColumn: "1 / -1" }} />
              <input type="date" value={evDate} onChange={(e) => setEvDate(e.target.value)} />
              <input type="time" placeholder="Time (HH:MM)" value={evTime} onChange={(e) => setEvTime(e.target.value)} />
              <input placeholder="Location *" value={evLocation} onChange={(e) => setEvLocation(e.target.value)} />
              <select value={evCategory} onChange={(e) => setEvCategory(e.target.value)}>
                <option value="hunt">🗺️ Hunt</option>
                <option value="meal">🍽️ Meal</option>
                <option value="activity">🎯 Activity</option>
                <option value="transport">🚗 Transport</option>
                <option value="other">📌 Other</option>
              </select>
              <input type="number" placeholder="Sort order" value={evSortOrder} onChange={(e) => setEvSortOrder(e.target.value)} style={{ width: "80px" }} />
            </div>
            <div className="ev-scoring-row">
              <label className="ev-scoring-label">Base pts<input type="number" min="0" value={evBasePoints} onChange={(e) => setEvBasePoints(e.target.value)} /></label>
              <label className="ev-scoring-label">Weight<input type="number" min="0.1" step="0.1" value={evWeight} onChange={(e) => setEvWeight(e.target.value)} /></label>
              <span className="ev-scoring-sep">Placement bonuses:</span>
              <label className="ev-scoring-label">🥇 1st<input type="number" min="0" value={evFirstBonus} onChange={(e) => setEvFirstBonus(e.target.value)} /></label>
              <label className="ev-scoring-label">🥈 2nd<input type="number" min="0" value={evSecondBonus} onChange={(e) => setEvSecondBonus(e.target.value)} /></label>
              <label className="ev-scoring-label">🥉 3rd<input type="number" min="0" value={evThirdBonus} onChange={(e) => setEvThirdBonus(e.target.value)} /></label>
              <span className="ev-scoring-preview">
                Effective: 🥇 {Math.round(Number(evBasePoints||0)*Number(evWeight||1)+Number(evFirstBonus||0))}
                · 🥈 {Math.round(Number(evBasePoints||0)*Number(evWeight||1)+Number(evSecondBonus||0))}
                · 🥉 {Math.round(Number(evBasePoints||0)*Number(evWeight||1)+Number(evThirdBonus||0))} pts
              </span>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
              <button onClick={() => { void saveEvent(); }}>{evEditId ? "Update Event" : "Add Event"}</button>
              {evEditId && <button onClick={clearEvForm}>Cancel</button>}
            </div>
            {evMsg && <p style={{ marginTop: "0.4rem", color: evMsg.startsWith("✓") ? "#4ade80" : "#f87171" }}>{evMsg}</p>}
          </div>
          {adminEvents.length === 0 && <p style={{ color: "#94a3b8" }}>No events yet. Add one above.</p>}
          <ul className="list" style={{ marginTop: "0.5rem" }}>
            {adminEvents.map((ev) => {
              const eff1 = Math.round(ev.basePoints * ev.weight + ev.firstPlaceBonus);
              const eff2 = Math.round(ev.basePoints * ev.weight + ev.secondPlaceBonus);
              const eff3 = Math.round(ev.basePoints * ev.weight + ev.thirdPlaceBonus);
              const hasScoring = ev.basePoints > 0 || ev.firstPlaceBonus > 0;
              const placed = ev.results ?? [];
              return (
                <li key={ev.id} className="ev-list-item">
                  <div className="ev-list-info">
                    <strong>{ev.title}</strong> · {ev.date} {ev.time && `@ ${ev.time}`}
                    {hasScoring && <span className="ev-pts-badge">🥇{eff1} 🥈{eff2} 🥉{eff3} pts</span>}
                    <br />
                    <span style={{ color: "#94a3b8", fontSize: "0.85rem" }}>📍 {ev.location} · {ev.category}{ev.weight !== 1 ? ` · ×${ev.weight} weight` : ""}</span>
                    {ev.description && <span style={{ color: "#94a3b8", fontSize: "0.85rem" }}> · {ev.description}</span>}
                    {placed.length > 0 && (
                      <div className="ev-results-summary">
                        {placed.map((r) => <span key={r.teamId} className="ev-result-pill">#{r.place} {r.teamId.toUpperCase()} +{r.pointsAwarded}pts</span>)}
                      </div>
                    )}
                  </div>
                  <div className="ev-list-actions">
                    <button onClick={() => startEditEvent(ev)}>Edit</button>
                    <button onClick={() => { setResultsEventId(ev.id === resultsEventId ? null : ev.id); setResultsFirst(""); setResultsSecond(""); setResultsThird(""); setResultsMsg(""); }}>
                      {ev.id === resultsEventId ? "Cancel" : "Results"}
                    </button>
                    <button className="btn-danger" onClick={() => { if (window.confirm(`Delete "${ev.title}"?`)) void deleteEvent(ev.id); }}>Del</button>
                  </div>
                  {resultsEventId === ev.id && (
                    <div className="ev-results-panel">
                      <div className="ev-results-row">
                        <label>🥇 1st team<select value={resultsFirst} onChange={(e) => setResultsFirst(e.target.value)}><option value="">—</option>{["spades","hearts","diamonds","clubs"].map((t) => <option key={t} value={t}>{t.toUpperCase()} (+{Math.round(ev.basePoints * ev.weight + ev.firstPlaceBonus)}pts)</option>)}</select></label>
                        <label>🥈 2nd team<select value={resultsSecond} onChange={(e) => setResultsSecond(e.target.value)}><option value="">—</option>{["spades","hearts","diamonds","clubs"].map((t) => <option key={t} value={t}>{t.toUpperCase()} (+{Math.round(ev.basePoints * ev.weight + ev.secondPlaceBonus)}pts)</option>)}</select></label>
                        <label>🥉 3rd team<select value={resultsThird} onChange={(e) => setResultsThird(e.target.value)}><option value="">—</option>{["spades","hearts","diamonds","clubs"].map((t) => <option key={t} value={t}>{t.toUpperCase()} (+{Math.round(ev.basePoints * ev.weight + ev.thirdPlaceBonus)}pts)</option>)}</select></label>
                      </div>
                      <button onClick={() => { void recordResults(); }}>Save Results &amp; Award Points</button>
                      {resultsMsg && <p style={{ color: resultsMsg.startsWith("✓") ? "#4ade80" : "#f87171", fontSize: "0.82rem", marginTop: "0.3rem" }}>{resultsMsg}</p>}
                    </div>
                  )}
                </li>
              );
            })}
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
    </ErrorBoundary>
  );
}

export default App;
