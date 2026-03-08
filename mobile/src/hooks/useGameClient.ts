import { useCallback, useEffect, useMemo, useState } from "react";
import { mobileApi } from "../services/api";
import {
  LeaderboardRow,
  ParticipantRole,
  SabotageAction,
  SubmissionHistoryItem,
  TeamEventFeedItem,
  TeamState
} from "../types/api";
import { derivePaginationState, parseLimitInput, parseOffsetInput } from "../utils/pagination";

const toErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
};

export const useGameClient = () => {
  const [joinCode, setJoinCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [captainPin, setCaptainPin] = useState("");
  const [submissionText, setSubmissionText] = useState("");

  const [authToken, setAuthToken] = useState<string | null>(null);
  const [role, setRole] = useState<ParticipantRole | null>(null);
  const [teamName, setTeamName] = useState("");

  const [teamState, setTeamState] = useState<TeamState | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [eventFeed, setEventFeed] = useState<TeamEventFeedItem[]>([]);
  const [eventFeedTotal, setEventFeedTotal] = useState(0);
  const [eventFeedLimit, setEventFeedLimit] = useState("12");
  const [eventFeedOffset, setEventFeedOffset] = useState("0");
  const [submissionHistory, setSubmissionHistory] = useState<SubmissionHistoryItem[]>([]);
  const [submissionHistoryTotal, setSubmissionHistoryTotal] = useState(0);
  const [submissionHistoryLimit, setSubmissionHistoryLimit] = useState("8");
  const [submissionHistoryOffset, setSubmissionHistoryOffset] = useState("0");
  const [sabotageCatalog, setSabotageCatalog] = useState<SabotageAction[]>([]);
  const [selectedSabotageActionId, setSelectedSabotageActionId] = useState("");
  const [targetTeamId, setTargetTeamId] = useState("");

  const [scanSessionToken, setScanSessionToken] = useState("");
  const [scanSessionExpiresAt, setScanSessionExpiresAt] = useState("");
  const [checkpointPublicId, setCheckpointPublicId] = useState("");

  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Ready");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isJoined = useMemo(() => Boolean(authToken), [authToken]);

  const eventFeedLimitValue = useMemo(() => parseLimitInput(eventFeedLimit, 12), [eventFeedLimit]);
  const eventFeedOffsetValue = useMemo(() => parseOffsetInput(eventFeedOffset, 0), [eventFeedOffset]);
  const eventFeedPagination = useMemo(
    () => derivePaginationState(eventFeedOffsetValue, eventFeedLimitValue, eventFeedTotal),
    [eventFeedLimitValue, eventFeedOffsetValue, eventFeedTotal]
  );

  const submissionHistoryLimitValue = useMemo(() => parseLimitInput(submissionHistoryLimit, 8), [submissionHistoryLimit]);
  const submissionHistoryOffsetValue = useMemo(() => parseOffsetInput(submissionHistoryOffset, 0), [submissionHistoryOffset]);
  const submissionHistoryPagination = useMemo(
    () => derivePaginationState(submissionHistoryOffsetValue, submissionHistoryLimitValue, submissionHistoryTotal),
    [submissionHistoryLimitValue, submissionHistoryOffsetValue, submissionHistoryTotal]
  );

  const refreshTeamState = useCallback(async (token: string) => {
    const state = await mobileApi.getTeamState(token);
    setTeamState(state);
    if (!checkpointPublicId && state.currentClue?.qr_public_id) {
      setCheckpointPublicId(state.currentClue.qr_public_id);
    }
  }, [checkpointPublicId]);

  const refreshLeaderboard = useCallback(async () => {
    const data = await mobileApi.getLeaderboard();
    setLeaderboard(data.teams);
  }, []);

  const refreshSabotageCatalog = useCallback(async () => {
    const data = await mobileApi.getSabotageCatalog();
    setSabotageCatalog(data.items);
    if (!selectedSabotageActionId && data.items.length > 0) {
      setSelectedSabotageActionId(data.items[0].id);
    }
  }, [selectedSabotageActionId]);

  const refreshEventFeed = useCallback(async (token: string, pagination?: { limit?: number; offset?: number }) => {
    const limit = typeof pagination?.limit === "number" ? pagination.limit : parseLimitInput(eventFeedLimit, 12);
    const offset = typeof pagination?.offset === "number" ? pagination.offset : parseOffsetInput(eventFeedOffset, 0);
    const data = await mobileApi.getTeamEventFeed(token, { limit, offset });
    setEventFeed(data.items);
    setEventFeedTotal(data.total);
    setEventFeedLimit(String(limit));
    setEventFeedOffset(String(offset));
  }, [eventFeedLimit, eventFeedOffset]);

  const refreshSubmissionHistory = useCallback(async (token: string, pagination?: { limit?: number; offset?: number }) => {
    const limit = typeof pagination?.limit === "number" ? pagination.limit : parseLimitInput(submissionHistoryLimit, 8);
    const offset = typeof pagination?.offset === "number" ? pagination.offset : parseOffsetInput(submissionHistoryOffset, 0);
    const data = await mobileApi.getTeamSubmissions(token, { limit, offset });
    setSubmissionHistory(data.items);
    setSubmissionHistoryTotal(data.total);
    setSubmissionHistoryLimit(String(limit));
    setSubmissionHistoryOffset(String(offset));
  }, [submissionHistoryLimit, submissionHistoryOffset]);

  const refreshAll = useCallback(async (token: string) => {
    await Promise.all([
      refreshTeamState(token),
      refreshLeaderboard(),
      refreshSabotageCatalog(),
      refreshEventFeed(token),
      refreshSubmissionHistory(token)
    ]);
    setStatusMessage("Synced with backend");
  }, [refreshEventFeed, refreshLeaderboard, refreshSabotageCatalog, refreshSubmissionHistory, refreshTeamState]);

  useEffect(() => {
    if (!authToken) {
      return;
    }

    const id = setInterval(() => {
      refreshAll(authToken).catch((error: unknown) => {
        setErrorMessage(toErrorMessage(error, "Failed to refresh state"));
      });
    }, 10000);

    return () => clearInterval(id);
  }, [authToken, refreshAll]);

  const join = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const body: { joinCode: string; displayName: string; captainPin?: string } = {
        joinCode: joinCode.trim(),
        displayName: displayName.trim()
      };

      if (captainPin.trim()) {
        body.captainPin = captainPin.trim();
      }

      const response = await mobileApi.join(body);
      setAuthToken(response.session.token);
      setRole(response.session.role);
      setTeamName(response.team.teamName);

      await refreshAll(response.session.token);
      setStatusMessage(`Joined ${response.team.teamName} as ${response.session.role}`);
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Join failed"));
    } finally {
      setLoading(false);
    }
  }, [captainPin, displayName, joinCode, refreshAll]);

  const refresh = useCallback(async () => {
    if (!authToken) {
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      await refreshAll(authToken);
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Refresh failed"));
    } finally {
      setLoading(false);
    }
  }, [authToken, refreshAll]);

  const submit = useCallback(async () => {
    if (!authToken) {
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const response = await mobileApi.submit(authToken, submissionText.trim());
      setStatusMessage(`Submission verdict: ${response.verdict} (+${response.pointsAwarded} pts)`);
      setSubmissionText("");
      await refreshAll(authToken);
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Submit failed"));
    } finally {
      setLoading(false);
    }
  }, [authToken, refreshAll, submissionText]);

  const pass = useCallback(async () => {
    if (!authToken) {
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      await mobileApi.pass(authToken);
      setStatusMessage("Clue passed");
      await refreshAll(authToken);
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Pass failed"));
    } finally {
      setLoading(false);
    }
  }, [authToken, refreshAll]);

  const createScanSession = useCallback(async () => {
    if (!authToken) {
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const response = await mobileApi.createScanSession(authToken);
      setScanSessionToken(response.scanSessionToken);
      setScanSessionExpiresAt(response.expiresAt);
      setStatusMessage(`Scan session created for clue ${response.clueIndex}`);
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Scan session creation failed"));
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  const validateScan = useCallback(async () => {
    if (!authToken) {
      return;
    }

    if (!scanSessionToken.trim() || !checkpointPublicId.trim()) {
      setErrorMessage("Scan session token and checkpoint public ID are required.");
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const response = await mobileApi.validateScan(authToken, scanSessionToken.trim(), checkpointPublicId.trim());
      setStatusMessage(`Scan validated: ${response.clueTitle}`);
      await refreshAll(authToken);
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Scan validation failed"));
    } finally {
      setLoading(false);
    }
  }, [authToken, checkpointPublicId, refreshAll, scanSessionToken]);

  const triggerSabotage = useCallback(async () => {
    if (!authToken) {
      return;
    }

    if (!selectedSabotageActionId.trim()) {
      setErrorMessage("Select a sabotage action first.");
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const response = await mobileApi.triggerSabotage(
        authToken,
        selectedSabotageActionId.trim(),
        targetTeamId.trim() || undefined
      );
      setStatusMessage(`Sabotage triggered: ${response.action.name}`);
      await refreshAll(authToken);
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Sabotage trigger failed"));
    } finally {
      setLoading(false);
    }
  }, [authToken, refreshAll, selectedSabotageActionId, targetTeamId]);

  const reportScreenshotAttempt = useCallback(async () => {
    if (!authToken) {
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const clueIndex = teamState?.currentClueIndex ?? 0;
      await mobileApi.reportSecurityEvent(authToken, {
        type: "SCREENSHOT_ATTEMPT",
        clueIndex,
        deviceInfo: "mobile-app-manual"
      });
      setStatusMessage("Security event reported");
      await refreshAll(authToken);
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Security event report failed"));
    } finally {
      setLoading(false);
    }
  }, [authToken, refreshAll, teamState?.currentClueIndex]);

  const prevEventFeedPage = useCallback(async () => {
    if (!authToken) {
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const nextOffset = Math.max(0, eventFeedOffsetValue - eventFeedLimitValue);
      await refreshEventFeed(authToken, { limit: eventFeedLimitValue, offset: nextOffset });
      setStatusMessage("Event feed page updated");
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Event feed paging failed"));
    } finally {
      setLoading(false);
    }
  }, [authToken, eventFeedLimitValue, eventFeedOffsetValue, refreshEventFeed]);

  const nextEventFeedPage = useCallback(async () => {
    if (!authToken) {
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const nextOffset = eventFeedOffsetValue + eventFeedLimitValue;
      if (nextOffset >= eventFeedTotal) {
        setStatusMessage("Event feed already at last page");
        return;
      }

      await refreshEventFeed(authToken, { limit: eventFeedLimitValue, offset: nextOffset });
      setStatusMessage("Event feed page updated");
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Event feed paging failed"));
    } finally {
      setLoading(false);
    }
  }, [authToken, eventFeedLimitValue, eventFeedOffsetValue, eventFeedTotal, refreshEventFeed]);

  const prevSubmissionHistoryPage = useCallback(async () => {
    if (!authToken) {
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const nextOffset = Math.max(0, submissionHistoryOffsetValue - submissionHistoryLimitValue);
      await refreshSubmissionHistory(authToken, { limit: submissionHistoryLimitValue, offset: nextOffset });
      setStatusMessage("Submission history page updated");
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Submission history paging failed"));
    } finally {
      setLoading(false);
    }
  }, [authToken, refreshSubmissionHistory, submissionHistoryLimitValue, submissionHistoryOffsetValue]);

  const nextSubmissionHistoryPage = useCallback(async () => {
    if (!authToken) {
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const nextOffset = submissionHistoryOffsetValue + submissionHistoryLimitValue;
      if (nextOffset >= submissionHistoryTotal) {
        setStatusMessage("Submission history already at last page");
        return;
      }

      await refreshSubmissionHistory(authToken, { limit: submissionHistoryLimitValue, offset: nextOffset });
      setStatusMessage("Submission history page updated");
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Submission history paging failed"));
    } finally {
      setLoading(false);
    }
  }, [
    authToken,
    refreshSubmissionHistory,
    submissionHistoryLimitValue,
    submissionHistoryOffsetValue,
    submissionHistoryTotal
  ]);

  return {
    apiBaseUrl: mobileApi.baseUrl,
    isJoined,
    loading,
    statusMessage,
    errorMessage,
    role,
    teamName,
    teamState,
    leaderboard,
    eventFeed,
    eventFeedTotal,
    eventFeedLimit,
    eventFeedOffset,
    eventFeedCurrentPage: eventFeedPagination.currentPage,
    eventFeedTotalPages: eventFeedPagination.totalPages,
    canPrevEventFeedPage: eventFeedPagination.canPrev,
    canNextEventFeedPage: eventFeedPagination.canNext,
    submissionHistory,
    submissionHistoryTotal,
    submissionHistoryLimit,
    submissionHistoryOffset,
    submissionHistoryCurrentPage: submissionHistoryPagination.currentPage,
    submissionHistoryTotalPages: submissionHistoryPagination.totalPages,
    canPrevSubmissionHistoryPage: submissionHistoryPagination.canPrev,
    canNextSubmissionHistoryPage: submissionHistoryPagination.canNext,
    sabotageCatalog,
    joinCode,
    displayName,
    captainPin,
    submissionText,
    scanSessionToken,
    scanSessionExpiresAt,
    checkpointPublicId,
    selectedSabotageActionId,
    targetTeamId,
    setJoinCode,
    setDisplayName,
    setCaptainPin,
    setSubmissionText,
    setScanSessionToken,
    setCheckpointPublicId,
    setSelectedSabotageActionId,
    setTargetTeamId,
    setEventFeedLimit,
    setEventFeedOffset,
    setSubmissionHistoryLimit,
    setSubmissionHistoryOffset,
    join,
    refresh,
    submit,
    pass,
    createScanSession,
    validateScan,
    triggerSabotage,
    reportScreenshotAttempt,
    prevEventFeedPage,
    nextEventFeedPage,
    prevSubmissionHistoryPage,
    nextSubmissionHistoryPage
  };
};
