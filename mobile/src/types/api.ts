export type ParticipantRole = "CAPTAIN" | "MEMBER";

export type TeamState = {
  teamId: string;
  teamName: string;
  scoreTotal: number;
  sabotageBalance: number;
  completedCount: number;
  skippedCount: number;
  currentClueIndex: number;
  eligibilityStatus: "ELIGIBLE" | "INELIGIBLE";
  currentClue?: {
    order_index: number;
    title: string;
    instructions: string;
    required_flag: boolean;
    requires_scan: boolean;
    transport_mode: string;
    submission_type: string;
    qr_public_id: string;
  };
};

export type LeaderboardRow = {
  teamId: string;
  teamName: string;
  scoreTotal: number;
  completedCount: number;
  skippedCount: number;
  currentClueIndex: number;
  eligibilityStatus: "ELIGIBLE" | "INELIGIBLE";
};

export type JoinResponse = {
  session: { token: string; role: ParticipantRole };
  team: { teamName: string };
};

export type ScanSessionResponse = {
  scanSessionToken: string;
  expiresAt: string;
  clueIndex: number;
};

export type ScanValidateResponse = {
  success: true;
  clueIndex: number;
  clueTitle: string;
};

export type SubmitResponse = {
  verdict: string;
  pointsAwarded: number;
};

export type SabotageAction = {
  id: string;
  name: string;
  description: string;
  cost: number;
  cooldownSeconds: number;
  effectType: string;
  effectDurationSeconds: number;
};

export type TriggerSabotageResponse = {
  purchase: {
    id: string;
    teamId: string;
    actionId: string;
    targetTeamId?: string;
    costDeducted: number;
    triggeredAt: string;
  };
  action: SabotageAction;
  sourceTeamId: string;
  targetTeamId?: string;
};

export type TeamEventFeedItem = {
  id: string;
  type: "SUBMISSION" | "SABOTAGE" | "SECURITY" | "AUDIT";
  timestamp: string;
  title: string;
  details?: Record<string, unknown>;
};

export type PaginatedResponse<TItem> = {
  items: TItem[];
  total: number;
  limit: number;
  offset: number;
};

export type SecurityEventResponse = {
  id: string;
  teamId: string;
  participantName?: string;
  type: "SCREENSHOT_ATTEMPT" | "OTHER";
  timestamp: string;
  clueIndex: number;
  deviceInfo?: string;
};

export type SubmissionHistoryItem = {
  id: string;
  clueIndex: number;
  verdict: "PASS" | "FAIL" | "NEEDS_REVIEW";
  aiScore: number;
  reasons: string[];
  pointsAwarded: number;
  createdAt: string;
  resolvedByAdmin: boolean;
  textContent?: string;
  mediaUrl?: string;
};
