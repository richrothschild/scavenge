import {
  JoinResponse,
  LeaderboardRow,
  PaginatedResponse,
  SabotageAction,
  SecurityEventResponse,
  SubmissionHistoryItem,
  ScanSessionResponse,
  ScanValidateResponse,
  SubmitResponse,
  TeamState,
  TeamEventFeedItem,
  TriggerSabotageResponse
} from "../types/api";

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api";

const requestJson = async <T,>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {})
    },
    ...options
  });

  const data = await response.json();
  if (!response.ok) {
    const message = typeof data?.error === "string" ? data.error : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return data as T;
};

export const mobileApi = {
  baseUrl: apiBaseUrl,

  join(body: { joinCode: string; displayName: string; captainPin?: string }) {
    return requestJson<JoinResponse>("/auth/join", {
      method: "POST",
      body: JSON.stringify(body)
    });
  },

  getTeamState(authToken: string) {
    return requestJson<TeamState>("/team/me/state", {
      method: "GET",
      headers: { "x-auth-token": authToken }
    });
  },

  getLeaderboard() {
    return requestJson<{ teams: LeaderboardRow[] }>("/leaderboard", { method: "GET" });
  },

  submit(authToken: string, textContent: string) {
    return requestJson<SubmitResponse>("/team/me/submit", {
      method: "POST",
      headers: { "x-auth-token": authToken },
      body: JSON.stringify({ textContent })
    });
  },

  pass(authToken: string) {
    return requestJson<{ passed: true; nextClueIndex: number }>("/team/me/pass", {
      method: "POST",
      headers: { "x-auth-token": authToken },
      body: JSON.stringify({})
    });
  },

  createScanSession(authToken: string) {
    return requestJson<ScanSessionResponse>("/team/me/scan-session", {
      method: "POST",
      headers: { "x-auth-token": authToken },
      body: JSON.stringify({})
    });
  },

  validateScan(authToken: string, scanSessionToken: string, checkpointPublicId: string) {
    return requestJson<ScanValidateResponse>("/team/me/scan-validate", {
      method: "POST",
      headers: { "x-auth-token": authToken },
      body: JSON.stringify({ scanSessionToken, checkpointPublicId })
    });
  },

  getSabotageCatalog() {
    return requestJson<{ items: SabotageAction[] }>("/sabotage/catalog", { method: "GET" });
  },

  triggerSabotage(authToken: string, actionId: string, targetTeamId?: string) {
    return requestJson<TriggerSabotageResponse>("/team/me/sabotage/trigger", {
      method: "POST",
      headers: { "x-auth-token": authToken },
      body: JSON.stringify({ actionId, targetTeamId })
    });
  },

  reportSecurityEvent(authToken: string, body: { type: "SCREENSHOT_ATTEMPT" | "OTHER"; clueIndex: number; deviceInfo?: string }) {
    return requestJson<SecurityEventResponse>("/team/me/security-events", {
      method: "POST",
      headers: { "x-auth-token": authToken },
      body: JSON.stringify(body)
    });
  },

  getTeamEventFeed(authToken: string, options?: { limit?: number; offset?: number }) {
    const query = new URLSearchParams();
    if (typeof options?.limit === "number") {
      query.set("limit", String(options.limit));
    }
    if (typeof options?.offset === "number") {
      query.set("offset", String(options.offset));
    }

    const suffix = query.toString() ? `?${query.toString()}` : "";

    return requestJson<PaginatedResponse<TeamEventFeedItem>>(`/team/me/event-feed${suffix}`, {
      method: "GET",
      headers: { "x-auth-token": authToken }
    });
  },

  getTeamSubmissions(authToken: string, options?: { limit?: number; offset?: number }) {
    const query = new URLSearchParams();
    if (typeof options?.limit === "number") {
      query.set("limit", String(options.limit));
    }
    if (typeof options?.offset === "number") {
      query.set("offset", String(options.offset));
    }

    const suffix = query.toString() ? `?${query.toString()}` : "";

    return requestJson<PaginatedResponse<SubmissionHistoryItem>>(`/team/me/submissions${suffix}`, {
      method: "GET",
      headers: { "x-auth-token": authToken }
    });
  }
};
