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
  expected_answer?: string;
  base_points: number;
  qr_public_id: string;
};

type SeedConfigV2Zone = {
  zone_id: string;
  name?: string;
  route_order?: number;
  transport_mode?: string;
};

type SeedConfigV2Clue = {
  id: string;
  route_order: number;
  zone_id?: string;
  title?: string;
  theme?: string;
  difficulty?: string;
  clue?: string;
  answer?: string;
  points?: number;
};

type SeedConfigV2Route = {
  route_id: string;
  name?: string;
  clue_ids: string[];
};

type SeedConfigV2 = {
  schema_version: string;
  dataset_type?: string;
  environment?: string;
  dataset_id?: string;
  metadata?: {
    name?: string;
    timezone?: string;
  };
  scoring?: {
    default_points?: number;
    special_points?: Record<string, number>;
  };
  zones?: SeedConfigV2Zone[];
  clues?: SeedConfigV2Clue[];
  routes?: SeedConfigV2Route[];
};

type SeedRoute = {
  routeId: string;
  name: string;
  clues: SeedClue[];
};

export type SeedConfig = {
  game: { name: string; status: GameStatus; timezone: string };
  teams: SeedTeam[];
  clues: SeedClue[];
  routes?: SeedRoute[];
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
  assignedParticipants: string[];
  scoreTotal: number;
  currentClueIndex: number;
  completedCount: number;
  skippedCount: number;
  clueStates: TeamProgressState[];
  routeId: string;
  routeName: string;
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
  type: "SUBMISSION" | "SECURITY" | "AUDIT";
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
  securityEvents: SecurityEvent[];
  auditLogs: AuditLog[];
  activeVariant?: SeedConfigVariant;
};

const MAX_OPTIONAL_SKIPS = 5;
const MIN_COMPLETED_FOR_ELIGIBILITY = 9;
const DEFAULT_SCAN_EXPIRY_SECONDS = 120;
const buildTeamId = (name: TeamName) => name.toLowerCase();
const buildRotatedQrId = (clueIndex: number) => `CLUE-${clueIndex + 1}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isLegacySeedConfig = (value: unknown): value is SeedConfig => {
  if (!isRecord(value)) return false;
  return isRecord(value.game) && Array.isArray(value.teams) && Array.isArray(value.clues);
};

const isSeedConfigV2 = (value: unknown): value is SeedConfigV2 => {
  if (!isRecord(value)) return false;
  return typeof value.schema_version === "string" && value.schema_version.startsWith("2.") && Array.isArray(value.clues);
};

const normalizeTransportMode = (value: string | undefined): SeedClue["transport_mode"] => {
  const normalized = (value ?? "").trim().toUpperCase().replace("-", "_");
  if (normalized === "WALK" || normalized === "WAYMO" || normalized === "CABLE_CAR") {
    return normalized;
  }

  return "NONE";
};

const sanitizeQrPublicId = (raw: string) => {
  const normalized = raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "-");
  return normalized || "CLUE-UNKNOWN";
};

const toPublicClue = (clue: SeedClue) => ({
  order_index: clue.order_index,
  title: clue.title,
  instructions: clue.instructions,
  required_flag: clue.required_flag,
  transport_mode: clue.transport_mode,
  requires_scan: clue.requires_scan,
  submission_type: clue.submission_type,
  base_points: clue.base_points,
  qr_public_id: clue.qr_public_id
});

const convertSeedConfigV2 = (value: SeedConfigV2, fallbackSeed?: SeedConfig): SeedConfig => {
  const fallbackTeams = fallbackSeed?.teams ?? [];
  if (fallbackTeams.length === 0) {
    throw new Error("Schema v2 dataset requires fallback team credentials from seed-config.json.");
  }

  const zonesById = new Map<string, SeedConfigV2Zone>();
  for (const zone of value.zones ?? []) {
    zonesById.set(zone.zone_id, zone);
  }

  const defaultPoints = Number.isFinite(value.scoring?.default_points)
    ? Math.max(1, Number(value.scoring?.default_points))
    : 1;
  const specialPoints = value.scoring?.special_points ?? {};

  const clues: SeedClue[] = [...(value.clues ?? [])]
    .filter((clue) => Number.isFinite(clue.route_order))
    .sort((a, b) => a.route_order - b.route_order)
    .map((clue, index) => {
      const zone = clue.zone_id ? zonesById.get(clue.zone_id) : undefined;
      const transportMode = normalizeTransportMode(zone?.transport_mode);
      const loweredIdentity = `${clue.id} ${clue.title ?? ""}`.toLowerCase();
      const isFinal = loweredIdentity.includes("final") || loweredIdentity.includes("finale") || clue.route_order >= 11;
      const isSpecialTransport = transportMode === "WAYMO" || transportMode === "CABLE_CAR";
      const pointWeight = Number.isFinite(clue.points)
        ? Number(clue.points)
        : (Number.isFinite(specialPoints[clue.id]) ? Number(specialPoints[clue.id]) : defaultPoints);
      const basePoints = Math.max(1, Math.round(pointWeight * 100));
      const title = clue.title?.trim() || `Clue ${clue.route_order}`;
      const theme = clue.theme?.trim();
      const difficulty = clue.difficulty?.trim();
      const cluePrompt = clue.clue?.trim();
      const generatedInstructions = cluePrompt || [
        `Use this clue title and theme to locate the correct place: ${title}.`,
        theme ? `Theme: ${theme}.` : "",
        difficulty ? `Difficulty: ${difficulty}.` : "",
        "Submit your best team evidence and answer from the app."
      ].filter(Boolean).join(" ");

      return {
        order_index: clue.route_order,
        title,
        instructions: generatedInstructions,
        required_flag: isFinal || isSpecialTransport,
        transport_mode: transportMode,
        requires_scan: false,
        submission_type: isFinal ? "TEXT" : "PHOTO",
        ai_rubric: `PASS when the team submission credibly matches clue '${title}'${theme ? ` (${theme})` : ""}.`,
        expected_answer: clue.answer?.trim() || undefined,
        base_points: basePoints,
        qr_public_id: sanitizeQrPublicId(clue.id || `CLUE-${index + 1}`)
      };
    });

  if (clues.length === 0) {
    throw new Error("Schema v2 dataset must include at least one clue.");
  }

  // Build per-route clue sequences if routes are defined
  const clueById = new Map<string, SeedClue>();
  for (const clue of clues) {
    clueById.set(clue.qr_public_id, clue); // keyed by sanitized id
  }
  // Also index by original clue id for route lookups
  const clueByOriginalId = new Map<string, SeedClue>();
  for (const rawClue of (value.clues ?? [])) {
    const sanitized = sanitizeQrPublicId(rawClue.id || "");
    const built = clueById.get(sanitized);
    if (built) clueByOriginalId.set(rawClue.id, built);
  }

  const routes: SeedRoute[] = (value.routes ?? []).map((r) => ({
    routeId: r.route_id,
    name: r.name ?? r.route_id,
    clues: r.clue_ids
      .map((id) => clueByOriginalId.get(id))
      .filter((c): c is SeedClue => !!c)
  })).filter((r) => r.clues.length > 0);

  return {
    game: {
      name: value.metadata?.name?.trim() || fallbackSeed?.game.name || "Scavenge Hunt",
      status: fallbackSeed?.game.status ?? "PENDING",
      timezone: value.metadata?.timezone?.trim() || fallbackSeed?.game.timezone || "America/Los_Angeles"
    },
    teams: fallbackTeams,
    clues,
    routes: routes.length > 0 ? routes : undefined
  };
};

export const normalizeSeedConfig = (value: unknown, fallbackSeed?: SeedConfig): SeedConfig => {
  if (isLegacySeedConfig(value)) {
    return value;
  }

  if (isSeedConfigV2(value)) {
    return convertSeedConfigV2(value, fallbackSeed);
  }

  throw new Error("Unsupported seed config format. Expected legacy SeedConfig or schema_version 2.x dataset.");
};

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

const parseSeedConfigFile = (seedPath: string, fallbackSeed?: SeedConfig): SeedConfig => {
  const raw = JSON.parse(fs.readFileSync(seedPath, "utf-8")) as unknown;
  return normalizeSeedConfig(raw, fallbackSeed);
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
  const defaultSeedPath = resolveSeedConfigPath(["seed-config.json"]);
  const defaultSeed = defaultSeedPath ? parseSeedConfigFile(defaultSeedPath) : undefined;

  const variantPath = resolveSeedConfigPath(variantFileCandidates[variant]);
  if (variantPath) {
    return {
      seed: parseSeedConfigFile(variantPath, defaultSeed),
      sourceFile: variantPath,
      resolvedSource: variant,
      fallbackToDefault: false
    };
  }

  if (!defaultSeedPath || !defaultSeed) {
    throw new Error("seed-config.json not found. Expected at repo root.");
  }

  return {
    seed: defaultSeed,
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

const shuffleArray = <T>(arr: T[]): T[] => {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

const createInitialSnapshot = (seed: SeedConfig): RuntimeSnapshot => {
  const globalClues = [...seed.clues].sort((a, b) => a.order_index - b.order_index);
  const routes = seed.routes ?? [];

  // Randomly assign one route per team (each team gets a different route when possible)
  const shuffledRoutes = shuffleArray(routes);

  const teams: TeamState[] = seed.teams.map((team, index) => {
    const assignedRoute = shuffledRoutes[index % Math.max(shuffledRoutes.length, 1)];
    const teamClues = assignedRoute?.clues ?? globalClues;
    const routeId = assignedRoute?.routeId ?? "";
    const routeName = assignedRoute?.name ?? "";

    return {
      teamId: buildTeamId(team.name),
      teamName: team.name,
      joinCode: team.join_code,
      captainName: team.captain_name,
      captainPin: team.captain_pin,
      assignedParticipants: [],
      scoreTotal: 0,
      currentClueIndex: 0,
      completedCount: 0,
      skippedCount: 0,
      routeId,
      routeName,
      clueStates: teamClues.map((clue, i) => ({
        clueId: clue.qr_public_id || `CLUE-${i + 1}`,
        status: (i === 0 ? "ACTIVE" : "LOCKED") as ClueStatus,
        scanValidated: false,
        pointsAwarded: 0
      }))
    };
  });

  return {
    gameStatus: seed.game.status,
    clueQrOverrides: {},
    teams,
    submissions: [],
    reviewQueue: [],
    securityEvents: [],
    auditLogs: []
  };
};

export class GameEngine {
  private clues: SeedClue[];
  private routeClueMap: Map<string, SeedClue[]>;
  private readonly store: RuntimeStateStore<RuntimeSnapshot>;
  private readonly teamsById = new Map<string, TeamState>();
  private readonly teamByJoinCode = new Map<string, TeamState>();
  private readonly participantSessionsByToken = new Map<string, ParticipantSession>();
  private readonly scanSessionsByToken = new Map<string, ScanSession>();
  private readonly adminSessions = new Set<string>();
  private readonly submissions: SubmissionRecord[];
  private readonly reviewQueue: ReviewQueueItem[];
  private readonly securityEvents: SecurityEvent[];
  private readonly auditLogs: AuditLog[];
  private readonly clueQrOverrides: Record<number, string>;
  private gameStatus: GameStatus;
  private joinLocked = false;
  private readonly pendingHints = new Map<string, { clueIndex: number; hintText: string }>();

  private teamClues(team: TeamState): SeedClue[] {
    const route = team.routeId ? this.routeClueMap.get(team.routeId) : undefined;
    return route ?? this.clues;
  }

  private constructor(private readonly seed: SeedConfig, store: RuntimeStateStore<RuntimeSnapshot>, snapshot: RuntimeSnapshot, private variant: SeedConfigVariant = "production") {
    this.clues = [...seed.clues].sort((a, b) => a.order_index - b.order_index);
    this.routeClueMap = new Map((seed.routes ?? []).map((r) => [r.routeId, r.clues]));
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
    this.securityEvents = [...snapshot.securityEvents];
    this.auditLogs = [...snapshot.auditLogs];
    snapshot.teams.forEach((team) => {
      team.assignedParticipants = Array.isArray(team.assignedParticipants)
        ? team.assignedParticipants.filter((value) => typeof value === "string" && value.trim().length > 0)
        : [];
      // Backwards compat: old snapshots won't have routeId
      if (!team.routeId) team.routeId = "";
      if (!team.routeName) team.routeName = "";
      this.teamsById.set(team.teamId, team);
      const fullJoinCode = team.joinCode.toUpperCase();
      this.teamByJoinCode.set(fullJoinCode, team);

      const shortJoinCode = fullJoinCode.includes("-") ? fullJoinCode.split("-")[0] : fullJoinCode;
      if (shortJoinCode && !this.teamByJoinCode.has(shortJoinCode)) {
        this.teamByJoinCode.set(shortJoinCode, team);
      }
    });
  }

  static async create(seed: SeedConfig, store: RuntimeStateStore<RuntimeSnapshot>, variant: SeedConfigVariant = "production") {
    const snapshot = (await store.load()) ?? createInitialSnapshot(seed);

    // If the persisted snapshot was saved under a different variant, re-load the correct seed
    const effectiveVariant = snapshot.activeVariant ?? variant;
    let effectiveSeed = seed;
    if (effectiveVariant !== variant) {
      try {
        const loaded = loadSeedConfigVariant(effectiveVariant);
        effectiveSeed = loaded.seed;
        console.log(`[GameEngine.create] Restoring persisted variant=${effectiveVariant} (env says ${variant}), source=${loaded.resolvedSource}, clues=${loaded.seed.clues.length}`);
      } catch (e) {
        console.warn(`[GameEngine.create] Failed to load persisted variant=${effectiveVariant}, falling back to env variant=${variant}:`, e);
      }
    }

    const engine = new GameEngine(effectiveSeed, store, snapshot, effectiveVariant);
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
      securityEvents: this.securityEvents,
      auditLogs: this.auditLogs,
      activeVariant: this.variant
    });
  }

  getGameStatus() {
    return { status: this.gameStatus, name: this.seed.game.name, timezone: this.seed.game.timezone, testMode: this.variant === "test", joinLocked: this.joinLocked };
  }

  toggleJoinLock() {
    this.joinLocked = !this.joinLocked;
    return this.getGameStatus();
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
    if (this.joinLocked) return { error: "Entry is currently locked. Check back soon." as const };
    const normalizedJoinCode = joinCode.trim().toUpperCase();
    const normalizedDisplayName = displayName.trim();
    const team = this.teamByJoinCode.get(normalizedJoinCode);
    if (!team) return { error: "Invalid join code." as const };
    if (!normalizedDisplayName) return { error: "displayName is required." as const };

    const assignedParticipant = team.assignedParticipants.find(
      (value) => value.trim().toLowerCase() === normalizedDisplayName.toLowerCase()
    );
    if (!assignedParticipant) {
      return { error: "Select your assigned name from this team's roster." as const };
    }

    let role: ParticipantRole = "MEMBER";
    if (this.variant === "test") {
      role = "CAPTAIN";
    } else if (captainPin) {
      if (captainPin !== team.captainPin) return { error: "Invalid captain PIN." as const };
      role = "CAPTAIN";
    }
    const token = crypto.randomUUID();
    const session = { token, teamId: team.teamId, displayName: assignedParticipant, role };
    this.participantSessionsByToken.set(token, session);
    return { session, team: { teamId: team.teamId, teamName: team.teamName, captainName: team.captainName } };
  }

  getSession(token: string | undefined) {
    return token ? this.participantSessionsByToken.get(token) ?? null : null;
  }

  getJoinOptions() {
    return Array.from(this.teamsById.values())
      .map((team) => ({
        teamId: team.teamId,
        teamName: team.teamName,
        captainName: team.captainName,
        assignedParticipants: [...team.assignedParticipants].sort((a, b) => a.localeCompare(b))
      }))
      .sort((a, b) => a.teamName.localeCompare(b.teamName));
  }

  getAdminTeamAssignments() {
    return Array.from(this.teamsById.values())
      .map((team) => ({
        teamId: team.teamId,
        teamName: team.teamName,
        captainName: team.captainName,
        captainPin: team.captainPin,
        assignedParticipants: [...team.assignedParticipants].sort((a, b) => a.localeCompare(b))
      }))
      .sort((a, b) => a.teamName.localeCompare(b.teamName));
  }

  async assignParticipantToTeam(teamId: string, participantName: string) {
    const team = this.teamsById.get(teamId);
    if (!team) return { error: "Team not found." as const };

    const normalizedParticipantName = participantName.trim();
    if (!normalizedParticipantName) return { error: "participantName is required." as const };

    const alreadyAssignedTeam = Array.from(this.teamsById.values()).find((candidate) =>
      candidate.assignedParticipants.some(
        (value) => value.trim().toLowerCase() === normalizedParticipantName.toLowerCase()
      )
    );
    if (alreadyAssignedTeam && alreadyAssignedTeam.teamId !== teamId) {
      return {
        error: `Participant is already assigned to ${alreadyAssignedTeam.teamId}. Team changes are not allowed once assigned.` as const
      };
    }

    if (alreadyAssignedTeam && alreadyAssignedTeam.teamId === teamId) {
      return { teamId, participantName: normalizedParticipantName, movedFromTeamId: null, alreadyAssigned: true };
    }

    team.assignedParticipants.push(normalizedParticipantName);
    team.assignedParticipants.sort((a, b) => a.localeCompare(b));

    this.auditLogs.push({
      id: crypto.randomUUID(),
      action: "TEAM_PARTICIPANT_ASSIGNED",
      targetType: "TEAM",
      targetId: teamId,
      reason: normalizedParticipantName,
      metadata: { participantName: normalizedParticipantName, movedFromTeamId: null },
      createdAt: new Date().toISOString()
    });

    await this.persist();
    return { teamId, participantName: normalizedParticipantName, movedFromTeamId: null, alreadyAssigned: false };
  }

  async removeParticipantFromTeam(teamId: string, participantName: string) {
    const team = this.teamsById.get(teamId);
    if (!team) return { error: "Team not found." as const };

    const normalizedParticipantName = participantName.trim();
    if (!normalizedParticipantName) return { error: "participantName is required." as const };

    const existingIndex = team.assignedParticipants.findIndex(
      (value) => value.trim().toLowerCase() === normalizedParticipantName.toLowerCase()
    );
    if (existingIndex < 0) return { error: "Participant not assigned to this team." as const };

    const [removedParticipantName] = team.assignedParticipants.splice(existingIndex, 1);

    this.auditLogs.push({
      id: crypto.randomUUID(),
      action: "TEAM_PARTICIPANT_REMOVED",
      targetType: "TEAM",
      targetId: teamId,
      reason: removedParticipantName,
      metadata: { participantName: removedParticipantName },
      createdAt: new Date().toISOString()
    });

    await this.persist();
    return { teamId, participantName: removedParticipantName };
  }

  async assignCaptainToTeam(teamId: string, captainName: string, captainPin: string, forceOverride = false) {
    const team = this.teamsById.get(teamId);
    if (!team) return { error: "Team not found." as const };

    if (this.gameStatus === "RUNNING" && !forceOverride) {
      return { error: "Captain reassignment is blocked while game is RUNNING. Set forceOverride=true to proceed." as const };
    }

    const normalizedCaptainName = captainName.trim();
    const normalizedCaptainPin = captainPin.trim();

    if (!normalizedCaptainName) return { error: "captainName is required." as const };
    if (!/^\d{6}$/.test(normalizedCaptainPin)) {
      return { error: "captainPin must be exactly 6 digits." as const };
    }

    const assignedCaptainTeam = Array.from(this.teamsById.values()).find((candidate) =>
      candidate.assignedParticipants.some(
        (value) => value.trim().toLowerCase() === normalizedCaptainName.toLowerCase()
      )
    );
    if (assignedCaptainTeam && assignedCaptainTeam.teamId !== teamId) {
      return {
        error: `Captain is already assigned to ${assignedCaptainTeam.teamId}. Team changes are not allowed once assigned.` as const
      };
    }

    if (!team.assignedParticipants.some((value) => value.trim().toLowerCase() === normalizedCaptainName.toLowerCase())) {
      return {
        error: "Captain must be assigned to this team roster before promotion." as const
      };
    }

    const previousCaptainName = team.captainName;
    const previousCaptainPin = team.captainPin;
    team.captainName = normalizedCaptainName;
    team.captainPin = normalizedCaptainPin;

    this.auditLogs.push({
      id: crypto.randomUUID(),
      action: "TEAM_CAPTAIN_UPDATED",
      targetType: "TEAM",
      targetId: teamId,
      reason: normalizedCaptainName,
      metadata: {
        previousCaptainName,
        previousCaptainPin,
        captainName: normalizedCaptainName,
        captainPin: normalizedCaptainPin,
        forceOverride
      },
      createdAt: new Date().toISOString()
    });

    await this.persist();
    return {
      teamId,
      captainName: normalizedCaptainName,
      captainPin: normalizedCaptainPin,
      forceOverrideApplied: forceOverride
    };
  }

  getTeamState(teamId: string) {
    const team = this.teamsById.get(teamId);
    if (!team) return null;
    const clues = this.teamClues(team);
    const currentClue = clues[team.currentClueIndex];
    console.log(`[getTeamState] team=${teamId} routeId=${team.routeId} clueCount=${clues.length} clue[0]=${clues[0]?.title} variant=${this.variant}`);
    const eligibilityStatus = team.completedCount >= MIN_COMPLETED_FOR_ELIGIBILITY ? "ELIGIBLE" : "INELIGIBLE";
    return {
      teamId: team.teamId,
      teamName: team.teamName,
      joinCode: team.joinCode,
      captainName: team.captainName,
      scoreTotal: team.scoreTotal,
      currentClueIndex: team.currentClueIndex,
      completedCount: team.completedCount,
      skippedCount: team.skippedCount,
      clueStates: team.clueStates,
      eligibilityStatus,
      currentClue: currentClue ? toPublicClue(currentClue) : null,
      clueCount: clues.length,
      routeId: team.routeId,
      routeName: team.routeName,
      minCluesForEligibility: MIN_COMPLETED_FOR_ELIGIBILITY,
      pendingHint: this.pendingHints.get(teamId) ?? null
    };
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
    const clue = this.teamClues(team)[team.currentClueIndex];
    if (clue.qr_public_id !== checkpointPublicId) return { error: "Checkpoint public ID does not match current clue." as const };
    team.clueStates[team.currentClueIndex].scanValidated = true;
    scanSession.used = true;
    await this.persist();
    return { success: true as const, clueIndex: team.currentClueIndex, clueTitle: clue.title };
  }

  getCurrentClue(teamId: string) {
    const team = this.teamsById.get(teamId);
    if (!team) return null;
    return this.teamClues(team)[team.currentClueIndex] ?? null;
  }

  getReviewQueue(limit = 100, offset = 0) {
    const pending = this.reviewQueue
      .filter((item) => item.status === "PENDING")
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    const page = pending.slice(offset, offset + limit);
    const items = page.map((item) => {
      const submission = this.submissions.find((s) => s.id === item.submissionId);
      return {
        ...item,
        textContent: submission?.textContent,
        mediaUrl: submission?.mediaUrl,
        aiScore: submission?.aiScore,
        aiReasons: submission?.reasons,
      };
    });

    return {
      items,
      total: pending.length,
      limit,
      offset
    };
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
      answer: clue.expected_answer ?? null
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

    const ordered = [...submissionEvents, ...securityEvents, ...auditEvents]
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
    if (clueIndex < 0 || clueIndex >= this.teamClues(team).length) return { error: "Invalid clue index." as const };
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
    this.pendingHints.set(teamId, { clueIndex, hintText });
    return { teamId, clueIndex, hintText };
  }

  async resetToVariant(variant: SeedConfigVariant) {
    const loaded = loadSeedConfigVariant(variant);
    const freshSnapshot = createInitialSnapshot(loaded.seed);

    for (const team of freshSnapshot.teams) {
      const existingTeam = this.teamsById.get(team.teamId);
      if (existingTeam) {
        team.assignedParticipants = [...existingTeam.assignedParticipants];
      }
    }

    await this.store.save({ ...freshSnapshot, activeVariant: variant });

    // Update in-memory state to match the fresh snapshot so mutations work immediately
    // without requiring a server restart.
    this.gameStatus = freshSnapshot.gameStatus;
    this.variant = variant;
    this.clues = [...loaded.seed.clues].sort((a, b) => a.order_index - b.order_index);
    this.routeClueMap = new Map((loaded.seed.routes ?? []).map((r) => [r.routeId, r.clues]));

    this.teamsById.clear();
    this.teamByJoinCode.clear();
    for (const team of freshSnapshot.teams) {
      this.teamsById.set(team.teamId, team);
      const fullJoinCode = team.joinCode.toUpperCase();
      this.teamByJoinCode.set(fullJoinCode, team);
      const shortJoinCode = fullJoinCode.includes("-") ? fullJoinCode.split("-")[0] : fullJoinCode;
      if (shortJoinCode && !this.teamByJoinCode.has(shortJoinCode)) {
        this.teamByJoinCode.set(shortJoinCode, team);
      }
    }

    // Invalidate all player sessions (team state changed underneath them)
    this.participantSessionsByToken.clear();
    this.scanSessionsByToken.clear();

    // Reset transient runtime collections
    this.submissions.splice(0);
    this.reviewQueue.splice(0);
    this.securityEvents.splice(0);
    this.pendingHints.clear();

    this.auditLogs.push({
      id: crypto.randomUUID(),
      action: "SEED_RESET",
      targetType: "GAME",
      targetId: "game",
      reason: `Reset to ${variant} variant`,
      metadata: { variant, resolvedSource: loaded.resolvedSource, clueCount: loaded.seed.clues.length },
      createdAt: new Date().toISOString()
    });
    return { variant, resolvedSource: loaded.resolvedSource, clueCount: loaded.seed.clues.length, requiresRestart: false };
  }

  async reopenTeamClue(teamId: string, clueIndex: number, reason: string, durationSeconds?: number) {
    const team = this.teamsById.get(teamId);
    if (!team) return { error: "Team not found." as const };
    if (clueIndex < 0 || clueIndex >= this.teamClues(team).length) return { error: "Invalid clue index." as const };

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
    const clue = this.teamClues(team)[team.currentClueIndex];
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
    const clue = this.teamClues(team)[reviewItem.clueIndex];
    const awarded = pointsAwarded ?? clue.base_points;

    submission.verdict = verdict;
    submission.resolvedByAdmin = true;

    if (verdict === "PASS") {
      if (state.status === "ACTIVE") {
        state.status = "COMPLETED";
        state.pointsAwarded = awarded;
        team.scoreTotal += awarded;
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
    const clue = this.teamClues(team)[team.currentClueIndex];
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
    if (nextIdx < this.teamClues(team).length) {
      team.currentClueIndex = nextIdx;
      if (team.clueStates[nextIdx].status === "LOCKED") {
        team.clueStates[nextIdx].status = "ACTIVE";
      }
    }
  }
}
