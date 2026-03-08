import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { io } from "socket.io-client";
import jsQR from "jsqr";
import { derivePaginationState, parseLimitInput, parseOffsetInput } from "./utils/pagination";
import "./App.css";

type Role = "CAPTAIN" | "MEMBER";

const apiBase =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.PROD
    ? "https://scavenge-backend-production.up.railway.app/api"
    : "http://localhost:3001/api");
const socketBase = apiBase.endsWith("/api") ? apiBase.slice(0, -4) : apiBase;

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

function App() {
  const isAdminPath = window.location.pathname.startsWith("/admin");
  const [mode] = useState<"player" | "admin">(isAdminPath ? "admin" : "player");
  const [adminView, setAdminView] = useState<"setup" | "live-ops">("live-ops");
  const [joinCode, setJoinCode] = useState("SPADES-AJ29LN");
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
    const payload = await response.json();
    return payload.error || fallback;
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

  const joinTeam = async (event: FormEvent) => {
    event.preventDefault();
    const response = await fetch(`${apiBase}/auth/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        joinCode,
        displayName,
        captainPin: captainPin.trim() ? captainPin : undefined
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatusMessage(payload.error || "Join failed");
      return;
    }
    setAuthToken(payload.session.token);
    setRole(payload.session.role);
    setTeamId(payload.session.teamId);
    setLastVerdict(null);
    setLastFeedback("");
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

  const fetchAdminClues = async () => {
    const response = await fetch(`${apiBase}/admin/clues`, { headers: { "Content-Type": "application/json", "x-admin-token": adminToken } });
    const payload = await response.json();
    if (response.ok) setAdminClues(payload.clues || []);
  };

  const fetchSabotageCatalog = async () => {
    const response = await fetch(`${apiBase}/sabotage/catalog`, { headers });
    const payload = await response.json();
    if (response.ok) setSabotageCatalog(payload.items || []);
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
    const response = await fetch(`${apiBase}/game/status`);
    const payload = await response.json();
    if (!response.ok) return setStatusMessage(payload.error || "Game status fetch failed");
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
    const response = await fetch(`${apiBase}/leaderboard`);
    const payload = await response.json();
    if (!response.ok) return setStatusMessage(payload.error || "Leaderboard fetch failed");
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
                <label className="field-label">Team code</label>
                <input
                  className="join-input"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="e.g. SPADES-AJ29LN"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <label className="field-label">Your name</label>
                <input
                  className="join-input"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="First name"
                />
                <label className="field-label">
                  Captain PIN <span className="field-optional">(captains only — leave blank if member)</span>
                </label>
                <input
                  className="join-input"
                  type="password"
                  inputMode="numeric"
                  value={captainPin}
                  onChange={(e) => setCaptainPin(e.target.value)}
                  placeholder="6-digit PIN"
                />
                <button className="join-btn" type="submit">Join Hunt →</button>
              </form>

              {statusMessage && statusMessage !== "Ready" && (
                <p className="join-error">{statusMessage}</p>
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
              <header className="player-header">
                <div className="player-header__team">
                  Team {(teamState?.teamName ?? teamId).toUpperCase()}
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
                            <video ref={videoRef} className="qr-video" playsInline muted />
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
        </div>
      )}

      {mode === "admin" && (
        <section>
          <h2>Admin Ops</h2>
          <form onSubmit={adminLogin} className="panel">
            <input value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} placeholder="Admin password" />
            <button type="submit">Login Admin</button>
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
              <div className="panel">
                <button onClick={() => { void fetchAdminClues(); }}>Load QR Codes</button>
                {adminClues.length > 0 && (
                  <button onClick={() => window.print()} style={{ marginLeft: "0.5rem" }}>🖨️ Print QR Sheet</button>
                )}
              </div>
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
