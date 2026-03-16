import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { io } from "socket.io-client";
import jsQR from "jsqr";
import { derivePaginationState, parseLimitInput, parseOffsetInput } from "./utils/pagination";
import "./App.css";

const TEAM_THEMES = {
  SPADES:   { suit: "♠", accent: "#818cf8", mascot: "⛓️",  fullName: "Alcatraz Aces",        landmark: "Alcatraz Island",   tagline: "Escaped from Alcatraz — and winning this hunt" },
  HEARTS:   { suit: "♥", accent: "#f87171", mascot: "🌉",  fullName: "Golden Gate Hearts",    landmark: "Golden Gate Bridge",tagline: "Crossing the bridge to victory"                 },
  DIAMONDS: { suit: "♦", accent: "#fbbf24", mascot: "🚃",  fullName: "Cable Car Diamonds",    landmark: "SF Cable Cars",     tagline: "All aboard the winning line"                    },
  CLUBS:    { suit: "♣", accent: "#4ade80", mascot: "🌿",  fullName: "Haight Clovers",        landmark: "Haight-Ashbury",    tagline: "Peace, love, and first place"                   },
} as const;
type TeamSuit = keyof typeof TEAM_THEMES;

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
type AdminClueResolvedSource = AdminClueSource | "active" | "default";

function App() {
  const isAdminPath = window.location.pathname.startsWith("/admin");
  const [mode] = useState<"player" | "admin">(isAdminPath ? "admin" : "player");
  const [adminView, setAdminView] = useState<"setup" | "live-ops">("live-ops");
  const [joinCode, setJoinCode] = useState("SPADES");
  const [displayName, setDisplayName] = useState("");
  const [captainPin, setCaptainPin] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [role, setRole] = useState<Role | null>(null);
  const [teamId, setTeamId] = useState("");
  const [teamState, setTeamState] = useState<any>(null);
  const [submitText, setSubmitText] = useState("");
  const [lastVerdict, setLastVerdict] = useState<"PASS" | "FAIL" | "NEEDS_REVIEW" | null>(null);
  const [lastFeedback, setLastFeedback] = useState("");
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
  const [invalidateTeamId, setInvalidateTeamId] = useState("");
  const [rotateClueIndex, setRotateClueIndex] = useState("0");
  const [rotateQrPublicId, setRotateQrPublicId] = useState("");
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
  // ── QR scanner ────────────────────────────────────────────────
  const [qrScanActive, setQrScanActive] = useState(false);
  const [qrScanStatus, setQrScanStatus] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const qrIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // ── Admin clues (for QR print) ────────────────────────────────
  const [adminClues, setAdminClues] = useState<any[]>([]);
  const [adminClueSource, setAdminClueSource] = useState<AdminClueSource>("production");
  const [adminClueResolvedSource, setAdminClueResolvedSource] = useState<AdminClueResolvedSource>("active");
  const [adminClueFallbackToDefault, setAdminClueFallbackToDefault] = useState(false);
  const [adminClueSourceFile, setAdminClueSourceFile] = useState("");
  const [adminClueUploadSource, setAdminClueUploadSource] = useState<AdminClueSource>("production");
  const [adminClueUploadFile, setAdminClueUploadFile] = useState<File | null>(null);
  const [adminClueUploadBusy, setAdminClueUploadBusy] = useState(false);
  // ── Verdict reveal overlay ────────────────────────────────────
  const [verdictReveal, setVerdictReveal] = useState<"PASS" | "FAIL" | "NEEDS_REVIEW" | null>(null);
  // ── Welcome screen ────────────────────────────────────────────
  const [showWelcome, setShowWelcome] = useState(false);
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

  const toFileName = (value: string) => {
    const parts = value.split(/[/\\]/);
    return parts[parts.length - 1] || value;
  };

  const buildDictatorSmsBody = (isTest: boolean) => {
    const teamName = normalizeTeamCodeInput(teamState?.teamName ?? joinCode) || "UNKNOWN";
    const clueNumber = (teamState?.currentClueIndex ?? 0) + 1;

    if (isTest) {
      return `SCAVENGE TEST\nTeam: ${teamName}\nClue: ${clueNumber}\nPlease ignore - this is a test text from the Help screen.`;
    }

    return `SCAVENGE HELP REQUEST\nTeam: ${teamName}\nClue: ${clueNumber}\nIssue: `;
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
          displayName,
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
    await refreshTeamState(payload.session.token);
    setStatusMessage(`Joined as ${payload.session.role}`);
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

  const ensureScanValidatedForCurrentClue = async () => {
    const currentClue = teamState?.currentClue;
    if (!currentClue?.requires_scan) {
      return { ok: true as const };
    }
    // Already validated via QR scanner
    if (teamState?.clueState?.scan_validated) {
      return { ok: true as const };
    }

    const scanSessionResponse = await fetch(`${apiBase}/team/me/scan-session`, {
      method: "POST",
      headers
    });
    const scanSessionPayload = await scanSessionResponse.json();
    if (!scanSessionResponse.ok) {
      return { ok: false as const, error: scanSessionPayload.error || "Failed to create scan session." };
    }

    const token = scanSessionPayload.scanSessionToken;
    const validateResponse = await fetch(`${apiBase}/team/me/scan-validate`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        scanSessionToken: token,
        checkpointPublicId: currentClue.qr_public_id
      })
    });
    const validatePayload = await validateResponse.json();
    if (!validateResponse.ok) {
      return { ok: false as const, error: validatePayload.error || "Failed to validate scan." };
    }

    return { ok: true as const };
  };

  const submitClue = async () => {
    setIsSubmitting(true);
    try {
      const scanResult = await ensureScanValidatedForCurrentClue();
      if (!scanResult.ok) {
        setStatusMessage(scanResult.error);
        return;
      }

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


  const startQrScanner = async () => {
    setQrScanActive(true);
    setQrScanStatus("Starting camera…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setQrScanStatus("Scanning… point at the QR code.");

      qrIntervalRef.current = setInterval(() => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || video.readyState < 2) return;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code?.data) {
          stopQrScanner(stream);
          handleQrResult(code.data);
        }
      }, 250);
    } catch (err) {
      setQrScanStatus("Camera access denied. Allow camera permission and try again.");
    }
  };

  const stopQrScanner = (stream?: MediaStream) => {
    if (qrIntervalRef.current) { clearInterval(qrIntervalRef.current); qrIntervalRef.current = null; }
    const s = stream ?? (videoRef.current?.srcObject as MediaStream | null);
    s?.getTracks().forEach(t => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setQrScanActive(false);
  };

  const handleQrResult = async (scannedId: string) => {
    setQrScanStatus(`Scanned: ${scannedId} — validating…`);
    const currentClue = teamState?.currentClue;
    if (!currentClue?.requires_scan) {
      setQrScanStatus("This clue does not require a scan. Proceeding.");
      return;
    }

    const scanSessionResponse = await fetch(`${apiBase}/team/me/scan-session`, { method: "POST", headers });
    const scanSessionPayload = await scanSessionResponse.json();
    if (!scanSessionResponse.ok) {
      setQrScanStatus(scanSessionPayload.error || "Failed to create scan session.");
      return;
    }

    const validateResponse = await fetch(`${apiBase}/team/me/scan-validate`, {
      method: "POST", headers,
      body: JSON.stringify({ scanSessionToken: scanSessionPayload.scanSessionToken, checkpointPublicId: scannedId })
    });
    const validatePayload = await validateResponse.json();
    if (!validateResponse.ok) {
      setQrScanStatus(validatePayload.error || "QR code not valid for this clue.");
      return;
    }
    setQrScanStatus("✅ Check-in confirmed! You can now submit your answer.");
    await refreshTeamState();
  };

  const fetchAdminClues = async (source: AdminClueSource = adminClueSource) => {
    const response = await fetch(`${apiBase}/admin/clues?source=${source}`, { headers: { "Content-Type": "application/json", "x-admin-token": adminToken } });
    const payload = await response.json();
    if (!response.ok) {
      setStatusMessage(payload.error || "Failed to load admin clues");
      return;
    }

    setAdminClues(payload.clues || []);
    setAdminClueSource(source);
    if (payload.resolvedSource === "test" || payload.resolvedSource === "production" || payload.resolvedSource === "active" || payload.resolvedSource === "default") {
      setAdminClueResolvedSource(payload.resolvedSource);
    }
    setAdminClueFallbackToDefault(Boolean(payload.fallbackToDefault));
    setAdminClueSourceFile(typeof payload.sourceFile === "string" ? payload.sourceFile : "");

    if (payload.fallbackToDefault) {
      setStatusMessage(`Loaded ${source} clues from default seed-config.json (missing ${source} seed file).`);
      return;
    }

    setStatusMessage(`Loaded ${source} clues.`);
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
      setAdminClueSource(adminClueUploadSource);
      await fetchAdminClues(adminClueUploadSource);
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
    void fetchGameStatus();
    void fetchLeaderboard();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

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
    sock.on("leaderboard:updated", () => { void fetchLeaderboard(); });
    sock.on("submission:verdict_ready", () => { void refreshTeamState(); });
    sock.on("sabotage:triggered", () => { void refreshTeamState(); });
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

  const invalidateScanSessions = async (event: FormEvent) => {
    event.preventDefault();
    const response = await fetch(`${apiBase}/admin/scan-sessions/invalidate`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ teamId: invalidateTeamId.trim() || undefined })
    });

    if (!response.ok) {
      setStatusMessage(await parseError(response, "Scan session invalidation failed"));
      return;
    }

    const payload = await response.json();
    setStatusMessage(`Invalidated ${payload.invalidatedCount} scan sessions`);
    await fetchAuditLogs();
  };

  const rotateQrPublicIdForClue = async (event: FormEvent) => {
    event.preventDefault();
    const clueIndex = Number(rotateClueIndex);
    if (!Number.isInteger(clueIndex) || clueIndex < 0) {
      setStatusMessage("Clue index must be a non-negative integer");
      return;
    }

    const response = await fetch(`${apiBase}/admin/clues/${clueIndex}/rotate-qr`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ qrPublicId: rotateQrPublicId.trim() || undefined })
    });

    if (!response.ok) {
      setStatusMessage(await parseError(response, "QR rotation failed"));
      return;
    }

    const payload = await response.json();
    setStatusMessage(`Clue ${payload.clueIndex + 1} QR rotated to ${payload.qrPublicId}`);
    setRotateQrPublicId(payload.qrPublicId);
    await fetchAuditLogs();
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
                <input
                  data-testid="join-code-input"
                  className="join-input"
                  value={joinCode}
                  onChange={(e) => setJoinCode(normalizeTeamCodeInput(e.target.value))}
                  placeholder="e.g. SPADES"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <label className="field-label">Your name</label>
                <input
                  data-testid="display-name-input"
                  className="join-input"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="First name"
                />
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
                <button data-testid="join-submit-btn" className="join-btn" type="submit">Join Hunt →</button>
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
                  {teamState?.currentClue ? (
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

                      <div className="clue-card">
                        <div className="clue-number">
                          Clue {(teamState.currentClueIndex ?? 0) + 1}
                          {teamState.currentClue.required_flag
                            ? <span className="clue-required">REQUIRED</span>
                            : <span className="clue-optional">optional</span>}
                        </div>
                        <h2 className="clue-title">{teamState.currentClue.title}</h2>
                        <p className="clue-text">{teamState.currentClue.instructions}</p>
                        {teamState.currentClue.requires_scan && (
                          <div className="scan-notice">
                            📱 QR code check-in required at this location
                            {teamState?.clueState?.scan_validated
                              ? <span className="scan-ok"> ✅ Checked in!</span>
                              : (
                                <button className="btn-scan" onClick={() => { void startQrScanner(); }}>
                                  Scan QR Code
                                </button>
                              )}
                          </div>
                        )}

                      {/* QR scanner modal */}
                      {qrScanActive && (
                        <div className="qr-overlay">
                          <div className="qr-modal">
                            <p className="qr-status">{qrScanStatus}</p>
                            <div className="qr-video-wrap">
                              <video ref={videoRef} className="qr-video" playsInline muted />
                              <div className="qr-viewfinder">
                                <span className="qvf qvf-tl" /><span className="qvf qvf-tr" />
                                <span className="qvf qvf-bl" /><span className="qvf qvf-br" />
                              </div>
                            </div>
                            <canvas ref={canvasRef} style={{ display: "none" }} />
                            <button className="btn-pass" onClick={() => stopQrScanner()}>Cancel</button>
                          </div>
                        </div>
                      )}
                      {!qrScanActive && qrScanStatus && (
                        <div className={`scan-result ${qrScanStatus.startsWith("✅") ? "scan-result--ok" : "scan-result--err"}`}>
                          {qrScanStatus}
                        </div>
                      )}
                      </div>

                      {/* Verdict */}
                      {lastVerdict && (
                        <div className={`verdict-banner verdict--${lastVerdict === "NEEDS_REVIEW" ? "needs-review" : lastVerdict.toLowerCase()}`}>
                          {lastVerdict === "PASS" && "✅ Correct! Great work — moving to the next clue."}
                          {lastVerdict === "FAIL" && "❌ Not quite — check the feedback below and try again."}
                          {lastVerdict === "NEEDS_REVIEW" && "⏳ Submitted for admin review. Stand by!"}
                          {lastFeedback && <p className="verdict-feedback">{lastFeedback}</p>}
                        </div>
                      )}

                      {/* Captain submit */}
                      {role === "CAPTAIN" ? (
                        <div className="submit-panel">
                          <div className="submit-heading">Submit your answer</div>
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
                              disabled={isSubmitting || (!submitText.trim() && !submitFile)}
                            >
                              {isSubmitting ? "Submitting…" : "Submit Answer ✓"}
                            </button>
                            {!teamState.currentClue.required_flag && (
                              <button
                                className="btn-pass"
                                onClick={() => { void passClue(); }}
                                disabled={isSubmitting}
                              >Skip this clue</button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="member-notice">
                          Only your team captain can submit answers or skip clues.
                        </div>
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
                      <h3>The Basics</h3>
                      <ul>
                        <li>Four teams race to solve <strong>12 clues</strong> hidden across the city.</li>
                        <li>All teammates see the same current clue at the same time.</li>
                        <li>Only the <strong>👑 Captain</strong> can submit answers, skip clues, or use sabotage.</li>
                      </ul>
                      <h3>Solving a Clue</h3>
                      <ul>
                        <li>Read the clue carefully and find the location or answer.</li>
                        <li>Some clues require a <strong>QR code scan</strong> at the spot — tap "Scan QR Code".</li>
                        <li>Submit a photo, video, or text description as proof.</li>
                        <li>An AI judge instantly reviews your submission. If it's unclear, an admin reviews it.</li>
                      </ul>
                      <h3>Transport</h3>
                      <ul>
                        <li>🚶 Most early clues are on foot.</li>
                        <li>🚗 One clue requires a <strong>Waymo</strong> ride — book it when you see the banner.</li>
                        <li>🚃 One clue requires the <strong>Cable Car</strong> to Buena Vista Bar.</li>
                      </ul>
                      <h3>Scoring &amp; Winning</h3>
                      <ul>
                        <li>Each clue awards points. Speed and accuracy matter.</li>
                        <li>Complete at least <strong>7 clues</strong> to be eligible to win.</li>
                        <li>You can skip up to <strong>5 optional clues</strong> — REQUIRED clues cannot be skipped.</li>
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
                        <li>Each team has exactly <strong>one captain</strong>. Only the captain can submit answers, skip clues, or trigger sabotage.</li>
                        <li>Teams must complete <strong>at least 7 clues</strong> to be eligible to win.</li>
                        <li>You may skip up to <strong>5 optional clues</strong>. <strong>REQUIRED clues cannot be skipped.</strong></li>
                        <li>You must <strong>physically be at the location</strong> to scan QR codes — no sharing QR codes between teams.</li>
                        <li><strong>No sharing answers</strong> with other teams. Each team must solve clues independently.</li>
                        <li>Do not travel to a future clue location before unlocking it.</li>
                        <li>Photo and video submissions must show your <strong>whole team</strong> unless the clue specifies otherwise.</li>
                        <li>AI verdicts are instant. Admin overrides are final.</li>
                        <li>Screenshots of clues will be flagged as a security event and may result in point deductions.</li>
                        <li>Required transport modes (<strong>Waymo</strong>, <strong>Cable Car</strong>) must be used — no substitutes.</li>
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
                        <div className="faq-a">Enter your team name (SPADES, HEARTS, DIAMONDS, or CLUBS). Captains must also enter their 6-digit PIN. Members leave the PIN blank.</div>
                      </div>
                      <div className="faq-item">
                        <div className="faq-q">The QR code won't scan</div>
                        <div className="faq-a">Allow camera access when prompted. Make sure you are physically at the correct location — QR scans are validated server-side and will fail if you're at the wrong clue.</div>
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

                      <div className="dictator-actions">
                        <a
                          className="btn-dictator"
                          href={buildDictatorSmsHref(false)}
                          onClick={() => { void handleDictatorClick(false); }}
                        >
                          📲 Contact the Dictator
                        </a>
                        <a
                          className="btn-dictator btn-dictator--test"
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
              <h3>Scan Session Controls</h3>
              <form onSubmit={invalidateScanSessions} className="panel">
                <input
                  value={invalidateTeamId}
                  onChange={(event) => setInvalidateTeamId(event.target.value)}
                  placeholder="Team id (optional; blank = all teams)"
                />
                <button type="submit">Invalidate Scan Sessions</button>
              </form>

              <h3>QR Rotation</h3>
              <form onSubmit={rotateQrPublicIdForClue} className="panel">
                <input
                  value={rotateClueIndex}
                  onChange={(event) => setRotateClueIndex(event.target.value)}
                  placeholder="Clue index (0-11)"
                />
                <input
                  value={rotateQrPublicId}
                  onChange={(event) => setRotateQrPublicId(event.target.value)}
                  placeholder="QR public id (optional; auto-generated if blank)"
                />
                <button type="submit">Rotate QR Public ID</button>
              </form>

              <h3>QR Codes</h3>
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
              <div className="panel">
                <button onClick={() => { void fetchAdminClues(adminClueSource); }}>
                  Load {adminClueSource === "test" ? "Test" : "Production"} QR Codes
                </button>
                <button onClick={() => { void fetchAdminClues(adminClueSource === "production" ? "test" : "production"); }}>
                  Show {adminClueSource === "production" ? "Test" : "Production"} Clues
                </button>
                {adminClues.length > 0 && (
                  <button onClick={() => window.print()} style={{ marginLeft: "0.5rem" }}>🖨️ Print QR Sheet</button>
                )}
              </div>
              <p className="clue-source-meta">
                Displaying <strong>{adminClueSource}</strong> clues
                {adminClueFallbackToDefault ? " (fallback: default seed-config.json)" : ""}
                {adminClueResolvedSource !== "active" ? ` · resolved source: ${adminClueResolvedSource}` : ""}
              </p>
              {adminClueSourceFile ? (
                <p className="clue-source-meta">Source file: {toFileName(adminClueSourceFile)}</p>
              ) : null}
              {adminClues.length > 0 && (
                <div className="qr-grid printable">
                  {adminClues.map((clue: any) => (
                    <div key={clue.index} className="qr-cell">
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(clue.qr_public_id)}`}
                        alt={clue.qr_public_id}
                        className="qr-img"
                      />
                      <div className="qr-label">
                        <strong>{clue.order_index}. {clue.title}</strong>
                        <div style={{ fontSize: "0.7rem", color: "#888" }}>{clue.qr_public_id}</div>
                        <div style={{ fontSize: "0.75rem" }}>
                          {clue.required_flag ? "REQUIRED" : "optional"} · {clue.base_points}pts
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

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
            <div className="actions-row">
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
