import crypto from "crypto";
import fs from "fs";
import path from "path";
import { RuntimeStateStore } from "../persistence/stateStore";

type GameStatus = "PENDING" | "RUNNING" | "PAUSED" | "ENDED";
type ParticipantRole = "CAPTAIN" | "MEMBER";
type ClueStatus = "LOCKED" | "ACTIVE" | "COMPLETED" | "PASSED";

type TeamName = "SPADES" | "HEARTS" | "DIAMONDS" | "CLUBS";

type SeedTeam = {
  name: TeamName;
  join_code: string;
  captain_name: string;
  captain_pin: string;
};

type SeedClue = {
  order_index: number;
  title: string;
  instructions: string;
  required_flag: boolean;
  transport_mode: "WALK" | "WAYMO" | "CABLE_CAR" | "NONE";
  requires_scan: boolean;
  submission_type: "PHOTO" | "VIDEO" | "TEXT" | "NONE";
  ai_rubric: string;
  base_points: number;
  qr_public_id: string;
};

type SeedSabotageAction = {
  name: string;
  description: string;
  cost: number;
  cooldown_seconds: number;
  effect_type: string;
  effect_duration_seconds?: number;
};

export type SeedConfig = {
  game: { name: string; status: GameStatus; timezone: string };
  teams: SeedTeam[];
  clues: SeedClue[];
  sabotage_catalog?: SeedSabotageAction[];
};

export type SeedConfigVariant = "test" | "production";
export type SeedConfigResolvedSource = SeedConfigVariant | "default";

export type SeedConfigVariantResult = {
  seed: SeedConfig;
  sourceFile: string;
  resolvedSource: SeedConfigResolvedSource;
  fallbackToDefault: boolean;
};

export type SeedConfigSaveResult = {
  sourceFile: string;
  clueCount: number;
};

type TeamProgressState = {
  clueId: string;
  status: ClueStatus;
  scanValidated: boolean;
  pointsAwarded: number;
  openedByAdminUntil?: string;
};

type TeamState = {
  teamId: string;
  teamName: TeamName;
  joinCode: string;
  captainName: string;
  captainPin: string;
  scoreTotal: number;
  sabotageBalance: number;
  currentClueIndex: number;
  completedCount: number;
  skippedCount: number;
  sabotageCooldowns: Record<string, number>;
  clueStates: TeamProgressState[];
};

type ParticipantSession = { token: string; teamId: string; displayName: string; role: ParticipantRole };
type ScanSession = { token: string; teamId: string; clueIndex: number; expiresAt: number; used: boolean };
type SubmissionVerdict = "PASS" | "FAIL" | "NEEDS_REVIEW";

type SubmissionRecord = {
  id: string;
  teamId: string;
  clueIndex: number;
  verdict: SubmissionVerdict;
  aiScore: number;
  reasons: string[];
  pointsAwarded: number;
  createdAt: string;
  textContent?: string;
  mediaUrl?: string;
  resolvedByAdmin: boolean;
};

type ReviewQueueItem = {
  id: string;
  submissionId: string;
  teamId: string;
  clueIndex: number;
  status: "PENDING" | "RESOLVED";
  createdAt: string;
  resolvedAt?: string;
};

type SabotageAction = {
  id: string;
  name: string;
  description: string;
  cost: number;
  cooldownSeconds: number;
  effectType: string;
  effectDurationSeconds: number;
};

type SabotagePurchase = {
  id: string;
  teamId: string;
  actionId: string;
  targetTeamId?: string;
  costDeducted: number;
  triggeredAt: string;
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

type AuditLog = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

type TeamEventFeedItem = {
  id: string;
  type: "SUBMISSION" | "SABOTAGE" | "SECURITY" | "AUDIT";
  timestamp: string;
  title: string;
  details?: Record<string, unknown>;
};

export type RuntimeSnapshot = {
  gameStatus: GameStatus;
  clueQrOverrides: Record<number, string>;
  teams: TeamState[];
  submissions: SubmissionRecord[];
  reviewQueue: ReviewQueueItem[];
  sabotagePurchases: SabotagePurchase[];
  securityEvents: SecurityEvent[];
  auditLogs: AuditLog[];
};

const MAX_OPTIONAL_SKIPS = 5;
const MIN_COMPLETED_FOR_ELIGIBILITY = 9;
const DEFAULT_SCAN_EXPIRY_SECONDS = 120;
const buildTeamId = (name: TeamName) => name.toLowerCase();
const buildRotatedQrId = (clueIndex: number) => `CLUE-${clueIndex + 1}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

const seedSearchRoots = [path.resolve(process.cwd(), ".."), path.resolve(process.cwd())];

const resolveSeedConfigPath = (fileNames: string[]): string | null => {
  for (const root of seedSearchRoots) {
    for (const fileName of fileNames) {
      const candidatePath = path.resolve(root, fileName);
      if (fs.existsSync(candidatePath)) {
        return candidatePath;
      }
    }
  }

  return null;
};

const parseSeedConfigFile = (seedPath: string): SeedConfig => {
  return JSON.parse(fs.readFileSync(seedPath, "utf-8")) as SeedConfig;
};

const variantFileCandidates: Record<SeedConfigVariant, string[]> = {
  test: ["seed-config.test.json", "seed-config.testing.json"],
  production: ["seed-config.production.json", "seed-config.prod.json"]
};

const resolveSeedStorageRoot = (): string => {
  for (const root of seedSearchRoots) {
    const canonical = path.resolve(root, "seed-config.json");
    if (fs.existsSync(canonical)) {
      return root;
    }
  }

  return seedSearchRoots[0];
};

export const loadSeedConfig = (): SeedConfig => {
  const seedPath = resolveSeedConfigPath(["seed-config.json"]);
  if (!seedPath) throw new Error("seed-config.json not found. Expected at repo root.");
  return parseSeedConfigFile(seedPath);
};

export const loadSeedConfigVariant = (variant: SeedConfigVariant): SeedConfigVariantResult => {
  const variantPath = resolveSeedConfigPath(variantFileCandidates[variant]);
  if (variantPath) {
    return {
      seed: parseSeedConfigFile(variantPath),
      sourceFile: variantPath,
      resolvedSource: variant,
      fallbackToDefault: false
    };
  }

  const defaultSeedPath = resolveSeedConfigPath(["seed-config.json"]);
  if (!defaultSeedPath) {
    throw new Error("seed-config.json not found. Expected at repo root.");
  }

  return {
    seed: parseSeedConfigFile(defaultSeedPath),
    sourceFile: defaultSeedPath,
    resolvedSource: "default",
    fallbackToDefault: true
  };
};

export const saveSeedConfigVariant = (variant: SeedConfigVariant, seed: SeedConfig): SeedConfigSaveResult => {
  const targetRoot = resolveSeedStorageRoot();
  const targetFileName = variantFileCandidates[variant][0];
  const targetPath = path.resolve(targetRoot, targetFileName);

  fs.writeFileSync(targetPath, `${JSON.stringify(seed, null, 2)}\n`, "utf-8");

  return {
    sourceFile: targetPath,
    clueCount: seed.clues.length
  };
};

const createInitialSnapshot = (seed: SeedConfig): RuntimeSnapshot => {
  const clues = [...seed.clues].sort((a, b) => a.order_index - b.order_index);
  const teams: TeamState[] = seed.teams.map((team) => ({
    teamId: buildTeamId(team.name),
    teamName: team.name,
    joinCode: team.join_code,
    captainName: team.captain_name,
    captainPin: team.captain_pin,
    scoreTotal: 0,
    sabotageBalance: 100,
    currentClueIndex: 0,
    completedCount: 0,
    skippedCount: 0,
    sabotageCooldowns: {},
    clueStates: clues.map((clue, index) => ({
      clueId: clue.qr_public_id || `CLUE-${index + 1}`,
      status: (index === 0 ? "ACTIVE" : "LOCKED") as ClueStatus,
      scanValidated: false,
      pointsAwarded: 0
    }))
  }));

  return {
    gameStatus: seed.game.status,
    clueQrOverrides: {},
    teams,
    submissions: [],
    reviewQueue: [],
    sabotagePurchases: [],
    securityEvents: [],
    auditLogs: []
  };
};

export class GameEngine {
  private readonly clues: SeedClue[];
  private readonly store: RuntimeStateStore<RuntimeSnapshot>;
  private readonly teamsById = new Map<string, TeamState>();
  private readonly teamByJoinCode = new Map<string, TeamState>();
  private readonly participantSessionsByToken = new Map<string, ParticipantSession>();
  private readonly scanSessionsByToken = new Map<string, ScanSession>();
  private readonly adminSessions = new Set<string>();
  private readonly submissions: SubmissionRecord[];
  private readonly reviewQueue: ReviewQueueItem[];
  private readonly sabotageCatalog: SabotageAction[];
  private readonly sabotagePurchases: SabotagePurchase[];
  private readonly securityEvents: SecurityEvent[];
  private readonly auditLogs: AuditLog[];
  private readonly clueQrOverrides: Record<number, string>;
  private gameStatus: GameStatus;

  private constructor(private readonly seed: SeedConfig, store: RuntimeStateStore<RuntimeSnapshot>, snapshot: RuntimeSnapshot) {
    this.clues = [...seed.clues].sort((a, b) => a.order_index - b.order_index);
    this.store = store;
    this.gameStatus = snapshot.gameStatus;
    this.clueQrOverrides = { ...(snapshot.clueQrOverrides ?? {}) };
    for (const [indexKey, qrPublicId] of Object.entries(this.clueQrOverrides)) {
      const index = Number(indexKey);
      if (Number.isInteger(index) && index >= 0 && index < this.clues.length) {
        this.clues[index].qr_public_id = qrPublicId;
      }
    }
    this.submissions = [...snapshot.submissions];
    this.reviewQueue = [...snapshot.reviewQueue];
    this.sabotageCatalog = (seed.sabotage_catalog ?? []).map((action, index) => ({
      id: `sabotage-${index + 1}`,
      name: action.name,
      description: action.description,
      cost: action.cost,
      cooldownSeconds: action.cooldown_seconds,
      effectType: action.effect_type,
      effectDurationSeconds: action.effect_duration_seconds ?? 0
    }));
    this.sabotagePurchases = [...snapshot.sabotagePurchases];
    this.securityEvents = [...snapshot.securityEvents];
    this.auditLogs = [...snapshot.auditLogs];
    snapshot.teams.forEach((team) => {
      this.teamsById.set(team.teamId, team);
      const fullJoinCode = team.joinCode.toUpperCase();
      this.teamByJoinCode.set(fullJoinCode, team);

      const shortJoinCode = fullJoinCode.includes("-") ? fullJoinCode.split("-")[0] : fullJoinCode;
      if (shortJoinCode && !this.teamByJoinCode.has(shortJoinCode)) {
        this.teamByJoinCode.set(shortJoinCode, team);
      }
    });
  }

  static async create(seed: SeedConfig, store: RuntimeStateStore<RuntimeSnapshot>) {
    const snapshot = (await store.load()) ?? createInitialSnapshot(seed);
    const engine = new GameEngine(seed, store, snapshot);
    await engine.persist();
    return engine;
  }

  private async persist() {
    await this.store.save({
      gameStatus: this.gameStatus,
      clueQrOverrides: this.clueQrOverrides,
      teams: Array.from(this.teamsById.values()),
      submissions: this.submissions,
      reviewQueue: this.reviewQueue,
      sabotagePurchases: this.sabotagePurchases,
      securityEvents: this.securityEvents,
      auditLogs: this.auditLogs
    });
  }

  getGameStatus() {
    return { status: this.gameStatus, name: this.seed.game.name, timezone: this.seed.game.timezone };
  }

  async setGameStatus(status: GameStatus) {
    this.gameStatus = status;
    await this.persist();
    return this.getGameStatus();
  }

  loginAdmin(password: string, expectedPassword: string) {
    if (password !== expectedPassword) return null;
    const token = crypto.randomUUID();
    this.adminSessions.add(token);
    return { token };
  }

  isAdminTokenValid(token: string | undefined) {
    return !!token && this.adminSessions.has(token);
  }

  joinTeam(joinCode: string, displayName: string, captainPin?: string) {
    const normalizedJoinCode = joinCode.trim().toUpperCase();
    const team = this.teamByJoinCode.get(normalizedJoinCode);
    if (!team) return { error: "Invalid join code." as const };
    let role: ParticipantRole = "MEMBER";
    if (captainPin) {
      if (captainPin !== team.captainPin) return { error: "Invalid captain PIN." as const };
      role = "CAPTAIN";
    }
    const token = crypto.randomUUID();
    const session = { token, teamId: team.teamId, displayName, role };
    this.participantSessionsByToken.set(token, session);
    return { session, team: { teamId: team.teamId, teamName: team.teamName, captainName: team.captainName } };
  }

  getSession(token: string | undefined) {
    return token ? this.participantSessionsByToken.get(token) ?? null : null;
  }

  getTeamState(teamId: string) {
    const team = this.teamsById.get(teamId);
    if (!team) return null;
    const currentClue = this.clues[team.currentClueIndex];
    const eligibilityStatus = team.completedCount >= MIN_COMPLETED_FOR_ELIGIBILITY ? "ELIGIBLE" : "INELIGIBLE";
    return { ...team, eligibilityStatus, currentClue };
  }

  getLeaderboard() {
    return Array.from(this.teamsById.values())
      .map((team) => ({
        teamId: team.teamId,
        teamName: team.teamName,
        scoreTotal: team.scoreTotal,
        completedCount: team.completedCount,
        skippedCount: team.skippedCount,
        currentClueIndex: team.currentClueIndex,
        eligibilityStatus: team.completedCount >= MIN_COMPLETED_FOR_ELIGIBILITY ? "ELIGIBLE" : "INELIGIBLE"
      }))
      .sort((a, b) => b.scoreTotal - a.scoreTotal);
  }

  createScanSession(teamId: string, expirySeconds = DEFAULT_SCAN_EXPIRY_SECONDS) {
    const team = this.teamsById.get(teamId);
    if (!team) return { error: "Team not found." as const };
    const token = crypto.randomUUID();
    const scanSession = { token, teamId, clueIndex: team.currentClueIndex, expiresAt: Date.now() + expirySeconds * 1000, used: false };
    this.scanSessionsByToken.set(token, scanSession);
    return { scanSessionToken: token, expiresAt: new Date(scanSession.expiresAt).toISOString(), clueIndex: team.currentClueIndex };
  }

  async invalidateScanSessions(teamId?: string) {
    let invalidated = 0;
    for (const scanSession of this.scanSessionsByToken.values()) {
      if (!teamId || scanSession.teamId === teamId) {
        if (!scanSession.used) {
          scanSession.used = true;
          invalidated += 1;
        }
      }
    }

    this.auditLogs.push({
      id: crypto.randomUUID(),
      action: "SCAN_SESSIONS_INVALIDATED",
      targetType: "SCAN_SESSION",
      targetId: teamId ?? "ALL",
      metadata: { teamId, invalidatedCount: invalidated },
      createdAt: new Date().toISOString()
    });

    await this.persist();
    return { invalidatedCount: invalidated, teamId: teamId ?? null };
  }

  async rotateClueQrPublicId(clueIndex: number, qrPublicId?: string) {
    if (!Number.isInteger(clueIndex) || clueIndex < 0 || clueIndex >= this.clues.length) {
      return { error: "Invalid clue index." as const };
    }

    const nextQrPublicId = qrPublicId?.trim() || buildRotatedQrId(clueIndex);
    this.clues[clueIndex].qr_public_id = nextQrPublicId;
    this.clueQrOverrides[clueIndex] = nextQrPublicId;

    this.auditLogs.push({
      id: crypto.randomUUID(),
      action: "QR_PUBLIC_ID_ROTATED",
      targetType: "CLUE",
      targetId: String(clueIndex),
      metadata: { clueIndex, qrPublicId: nextQrPublicId },
      createdAt: new Date().toISOString()
    });

    await this.persist();
    return { clueIndex, qrPublicId: nextQrPublicId };
  }

  async validateScan(teamId: string, scanSessionToken: string, checkpointPublicId: string) {
    const team = this.teamsById.get(teamId);
    if (!team) return { error: "Team not found." as const };
    const scanSession = this.scanSessionsByToken.get(scanSessionToken);
    if (!scanSession) return { error: "Invalid scan session token." as const };
    if (scanSession.used) return { error: "Scan session token already used." as const };
    if (scanSession.teamId !== teamId) return { error: "Scan session token does not match team." as const };
    if (scanSession.clueIndex !== team.currentClueIndex) return { error: "Scan session token does not match current clue." as const };
    if (scanSession.expiresAt < Date.now()) return { error: "Scan session token expired." as const };
    const clue = this.clues[team.currentClueIndex];
    if (clue.qr_public_id !== checkpointPublicId) return { error: "Checkpoint public ID does not match current clue." as const };
    team.clueStates[team.currentClueIndex].scanValidated = true;
    scanSession.used = true;
    await this.persist();
    return { success: true as const, clueIndex: team.currentClueIndex, clueTitle: clue.title };
  }

  getCurrentClue(teamId: string) {
    const team = this.teamsById.get(teamId);
    if (!team) return null;
    return this.clues[team.currentClueIndex] ?? null;
  }

  getReviewQueue(limit = 100, offset = 0) {
    const pending = this.reviewQueue
      .filter((item) => item.status === "PENDING")
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    return {
      items: pending.slice(offset, offset + limit),
      total: pending.length,
      limit,
      offset
    };
  }

  getSabotageCatalog() {
    return this.sabotageCatalog;
  }

  getAllClues() {
    return this.clues.map((clue, index) => ({
      index,
      order_index: clue.order_index,
      title: clue.title,
      instructions: clue.instructions,
      required_flag: clue.required_flag,
      transport_mode: clue.transport_mode,
      requires_scan: clue.requires_scan,
      submission_type: clue.submission_type,
      base_points: clue.base_points,
      qr_public_id: clue.qr_public_id,
    }));
  }

  getSecurityEvents(limit = 100, offset = 0) {
    const ordered = [...this.securityEvents]
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

    return {
      items: ordered.slice(offset, offset + limit),
      total: ordered.length,
      limit,
      offset
    };
  }

  getAuditLogs(limit = 100, offset = 0) {
    const ordered = [...this.auditLogs]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    return {
      items: ordered.slice(offset, offset + limit),
      total: ordered.length,
      limit,
      offset
    };
  }

  getTeamEventFeed(teamId: string, limit = 100, offset = 0) {
    const team = this.teamsById.get(teamId);
    if (!team) return null;

    const submissionEvents: TeamEventFeedItem[] = this.submissions
      .filter((entry) => entry.teamId === teamId)
      .map((entry) => ({
        id: `submission:${entry.id}`,
        type: "SUBMISSION",
        timestamp: entry.createdAt,
        title: `Submission ${entry.verdict}`,
        details: {
          clueIndex: entry.clueIndex,
          pointsAwarded: entry.pointsAwarded,
          resolvedByAdmin: entry.resolvedByAdmin
        }
      }));

    const sabotageEvents: TeamEventFeedItem[] = this.sabotagePurchases
      .filter((entry) => entry.teamId === teamId || entry.targetTeamId === teamId)
      .map((entry) => ({
        id: `sabotage:${entry.id}`,
        type: "SABOTAGE",
        timestamp: entry.triggeredAt,
        title: "Sabotage triggered",
        details: {
          actionId: entry.actionId,
          sourceTeamId: entry.teamId,
          targetTeamId: entry.targetTeamId,
          costDeducted: entry.costDeducted
        }
      }));

    const securityEvents: TeamEventFeedItem[] = this.securityEvents
      .filter((entry) => entry.teamId === teamId)
      .map((entry) => ({
        id: `security:${entry.id}`,
        type: "SECURITY",
        timestamp: entry.timestamp,
        title: "Security event detected",
        details: {
          eventType: entry.type,
          clueIndex: entry.clueIndex,
          participantName: entry.participantName
        }
      }));

    const auditEvents: TeamEventFeedItem[] = this.auditLogs
      .filter((entry) => entry.targetId === teamId || entry.targetId.startsWith(`${teamId}:`))
      .map((entry) => ({
        id: `audit:${entry.id}`,
        type: "AUDIT",
        timestamp: entry.createdAt,
        title: entry.action,
        details: {
          targetType: entry.targetType,
          targetId: entry.targetId,
          reason: entry.reason,
          ...(entry.metadata ?? {})
        }
      }));

    const ordered = [...submissionEvents, ...sabotageEvents, ...securityEvents, ...auditEvents]
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

    return {
      items: ordered.slice(offset, offset + limit),
      total: ordered.length,
      limit,
      offset
    };
  }

  getTeamSubmissions(teamId: string, limit = 50, offset = 0) {
    const team = this.teamsById.get(teamId);
    if (!team) return null;

    const ordered = this.submissions
      .filter((entry) => entry.teamId === teamId)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    const items = ordered
      .slice(offset, offset + limit)
      .map((entry) => ({
        id: entry.id,
        clueIndex: entry.clueIndex,
        verdict: entry.verdict,
        aiScore: entry.aiScore,
        reasons: entry.reasons,
        pointsAwarded: entry.pointsAwarded,
        createdAt: entry.createdAt,
        resolvedByAdmin: entry.resolvedByAdmin,
        textContent: entry.textContent,
        mediaUrl: entry.mediaUrl
      }));

    return {
      items,
      total: ordered.length,
      limit,
      offset
    };
  }

  async triggerSabotage(teamId: string, actionId: string, targetTeamId?: string) {
    const team = this.teamsById.get(teamId);
    if (!team) return { error: "Team not found." as const };

    const action = this.sabotageCatalog.find((item) => item.id === actionId);
    if (!action) return { error: "Sabotage action not found." as const };

    const now = Date.now();
    const cooldownUntil = team.sabotageCooldowns[action.id] ?? 0;
    if (cooldownUntil > now) {
      return { error: "Sabotage action is on cooldown." as const };
    }
    if (team.sabotageBalance < action.cost) {
      return { error: "Insufficient sabotage balance." as const };
    }

    if (targetTeamId && !this.teamsById.has(targetTeamId)) {
      return { error: "Target team not found." as const };
    }

    team.sabotageBalance -= action.cost;
    team.sabotageCooldowns[action.id] = now + action.cooldownSeconds * 1000;

    const purchase: SabotagePurchase = {
      id: crypto.randomUUID(),
      teamId,
      actionId,
      targetTeamId,
      costDeducted: action.cost,
      triggeredAt: new Date().toISOString()
    };
    this.sabotagePurchases.push(purchase);
    this.auditLogs.push({
      id: crypto.randomUUID(),
      action: "SABOTAGE_TRIGGERED",
      targetType: "TEAM",
      targetId: targetTeamId ?? teamId,
      metadata: { actionId, sourceTeamId: teamId, cost: action.cost },
      createdAt: purchase.triggeredAt
    });

    await this.persist();

    return {
      purchase,
      action,
      sourceTeamId: teamId,
      targetTeamId
    };
  }

  async recordSecurityEvent(teamId: string, event: Omit<SecurityEvent, "id" | "teamId" | "timestamp">) {
    const team = this.teamsById.get(teamId);
    if (!team) return { error: "Team not found." as const };

    const securityEvent: SecurityEvent = {
      id: crypto.randomUUID(),
      teamId,
      participantName: event.participantName,
      type: event.type,
      timestamp: new Date().toISOString(),
      clueIndex: event.clueIndex,
      deviceInfo: event.deviceInfo
    };

    this.securityEvents.push(securityEvent);
    this.auditLogs.push({
      id: crypto.randomUUID(),
      action: "SECURITY_EVENT",
      targetType: "TEAM",
      targetId: teamId,
      metadata: { type: securityEvent.type, clueIndex: securityEvent.clueIndex },
      createdAt: securityEvent.timestamp
    });

    await this.persist();
    return securityEvent;
  }

  async deductTeamPoints(teamId: string, amount: number, reason: string) {
    const team = this.teamsById.get(teamId);
    if (!team) return { error: "Team not found." as const };
    if (amount <= 0) return { error: "Deduction amount must be positive." as const };

    team.scoreTotal = Math.max(0, team.scoreTotal - amount);
    this.auditLogs.push({
      id: crypto.randomUUID(),
      action: "POINTS_DEDUCTED",
      targetType: "TEAM",
      targetId: teamId,
      reason,
      metadata: { amount },
      createdAt: new Date().toISOString()
    });

    await this.persist();
    return { teamId, scoreTotal: team.scoreTotal, amount, reason };
  }

  async awardTeamPoints(teamId: string, amount: number, reason: string) {
    const team = this.teamsById.get(teamId);
    if (!team) return { error: "Team not found." as const };
    if (amount <= 0) return { error: "Award amount must be positive." as const };

    team.scoreTotal += amount;
    this.auditLogs.push({
      id: crypto.randomUUID(),
      action: "POINTS_AWARDED",
      targetType: "TEAM",
      targetId: teamId,
      reason,
      metadata: { amount },
      createdAt: new Date().toISOString()
    });

    await this.persist();
    return { teamId, scoreTotal: team.scoreTotal, amount, reason };
  }

  async recordAdminHint(teamId: string, clueIndex: number, hintText: string) {
    const team = this.teamsById.get(teamId);
    if (!team) return { error: "Team not found." as const };
    if (clueIndex < 0 || clueIndex >= this.clues.length) return { error: "Invalid clue index." as const };
    if (!hintText.trim()) return { error: "Hint text is required." as const };

    this.auditLogs.push({
      id: crypto.randomUUID(),
      action: "HINT_SENT",
      targetType: "TEAM_CLUE",
      targetId: `${teamId}:${clueIndex}`,
      reason: hintText,
      metadata: { clueIndex, hintText },
      createdAt: new Date().toISOString()
    });

    await this.persist();
    return { teamId, clueIndex, hintText };
  }

  async resetToVariant(variant: SeedConfigVariant) {
    const loaded = loadSeedConfigVariant(variant);
    const freshSnapshot = createInitialSnapshot(loaded.seed);
    await this.store.save(freshSnapshot);
    this.auditLogs.push({
      id: crypto.randomUUID(),
      action: "SEED_RESET",
      targetType: "GAME",
      targetId: "game",
      reason: `Reset to ${variant} variant`,
      metadata: { variant, resolvedSource: loaded.resolvedSource, clueCount: loaded.seed.clues.length },
      createdAt: new Date().toISOString()
    });
    return { variant, resolvedSource: loaded.resolvedSource, clueCount: loaded.seed.clues.length, requiresRestart: true };
  }

  async reopenTeamClue(teamId: string, clueIndex: number, reason: string, durationSeconds?: number) {
    const team = this.teamsById.get(teamId);
    if (!team) return { error: "Team not found." as const };
    if (clueIndex < 0 || clueIndex >= this.clues.length) return { error: "Invalid clue index." as const };

    const state = team.clueStates[clueIndex];
    state.status = "ACTIVE";
    state.openedByAdminUntil = durationSeconds ? new Date(Date.now() + durationSeconds * 1000).toISOString() : undefined;
    team.currentClueIndex = clueIndex;

    this.auditLogs.push({
      id: crypto.randomUUID(),
      action: "CLUE_REOPENED",
      targetType: "TEAM_CLUE",
      targetId: `${teamId}:${clueIndex}`,
      reason,
      metadata: { durationSeconds },
      createdAt: new Date().toISOString()
    });

    await this.persist();
    return {
      teamId,
      clueIndex,
      openedByAdminUntil: state.openedByAdminUntil
    };
  }

  async submitCurrentClue(
    teamId: string,
    input: { textContent?: string; mediaUrl?: string },
    verdict: SubmissionVerdict,
    aiScore: number,
    reasons: string[]
  ) {
    const team = this.teamsById.get(teamId);
    if (!team) return { error: "Team not found." as const };
    const clue = this.clues[team.currentClueIndex];
    const state = team.clueStates[team.currentClueIndex];
    if (state.status !== "ACTIVE") return { error: "Current clue is not active." as const };
    if (clue.requires_scan && !state.scanValidated) return { error: "QR scan validation required before submission." as const };

    const submission: SubmissionRecord = {
      id: crypto.randomUUID(),
      teamId,
      clueIndex: team.currentClueIndex,
      verdict,
      aiScore,
      reasons,
      pointsAwarded: 0,
      createdAt: new Date().toISOString(),
      textContent: input.textContent,
      mediaUrl: input.mediaUrl,
      resolvedByAdmin: false
    };

    if (verdict === "PASS") {
      state.status = "COMPLETED";
      state.pointsAwarded = clue.base_points;
      team.scoreTotal += clue.base_points;
      team.sabotageBalance += Math.floor(clue.base_points * 0.2);
      team.completedCount += 1;
      submission.pointsAwarded = clue.base_points;
      this.advanceToNextClue(team);
    }

    if (verdict === "NEEDS_REVIEW") {
      this.reviewQueue.push({
        id: crypto.randomUUID(),
        submissionId: submission.id,
        teamId,
        clueIndex: team.currentClueIndex,
        status: "PENDING",
        createdAt: submission.createdAt
      });
    }

    this.submissions.push(submission);
    await this.persist();

    return {
      verdict,
      pointsAwarded: submission.pointsAwarded,
      nextClueIndex: team.currentClueIndex,
      submissionId: submission.id
    };
  }

  async resolveReviewItem(reviewId: string, verdict: "PASS" | "FAIL", pointsAwarded?: number) {
    const reviewItem = this.reviewQueue.find((item) => item.id === reviewId && item.status === "PENDING");
    if (!reviewItem) {
      return { error: "Review item not found." as const };
    }

    const submission = this.submissions.find((entry) => entry.id === reviewItem.submissionId);
    if (!submission) {
      return { error: "Submission not found for review item." as const };
    }

    const team = this.teamsById.get(reviewItem.teamId);
    if (!team) {
      return { error: "Team not found." as const };
    }

    const state = team.clueStates[reviewItem.clueIndex];
    const clue = this.clues[reviewItem.clueIndex];
    const awarded = pointsAwarded ?? clue.base_points;

    submission.verdict = verdict;
    submission.resolvedByAdmin = true;

    if (verdict === "PASS") {
      if (state.status === "ACTIVE") {
        state.status = "COMPLETED";
        state.pointsAwarded = awarded;
        team.scoreTotal += awarded;
        team.sabotageBalance += Math.floor(awarded * 0.2);
        team.completedCount += 1;
        submission.pointsAwarded = awarded;
        this.advanceToNextClue(team);
      }
    }

    reviewItem.status = "RESOLVED";
    reviewItem.resolvedAt = new Date().toISOString();

    await this.persist();

    return {
      reviewId,
      verdict,
      teamId: reviewItem.teamId,
      currentClueIndex: team.currentClueIndex,
      pointsAwarded: submission.pointsAwarded
    };
  }

  async passCurrentClue(teamId: string) {
    const team = this.teamsById.get(teamId);
    if (!team) return { error: "Team not found." as const };
    const clue = this.clues[team.currentClueIndex];
    const state = team.clueStates[team.currentClueIndex];
    if (state.status !== "ACTIVE") return { error: "Current clue is not active." as const };
    if (clue.required_flag) return { error: "Required clues cannot be passed." as const };
    if (team.skippedCount >= MAX_OPTIONAL_SKIPS) return { error: "Maximum optional passes reached." as const };

    state.status = "PASSED";
    team.skippedCount += 1;
    this.advanceToNextClue(team);
    await this.persist();

    return { passed: true as const, nextClueIndex: team.currentClueIndex };
  }

  private advanceToNextClue(team: TeamState) {
    const nextIdx = team.currentClueIndex + 1;
    if (nextIdx < this.clues.length) {
      team.currentClueIndex = nextIdx;
      if (team.clueStates[nextIdx].status === "LOCKED") {
        team.clueStates[nextIdx].status = "ACTIVE";
      }
    }
  }
}
