import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Request, Response, Router } from "express";
import { Server } from "socket.io";
import { z } from "zod";
import { env } from "../config/env";
import { AIJudgeProvider } from "../services/aiJudge";
import { GameEngine, SeedConfig, SeedConfigVariant, loadSeedConfig, loadSeedConfigVariant, normalizeSeedConfig, saveSeedConfigVariant } from "../services/gameEngine";
import { parseLimit } from "../utils/parseLimit";
import { parseOffset } from "../utils/parseOffset";

const getAuthToken = (headers: Record<string, unknown>) => {
  const token = headers["x-auth-token"];
  return typeof token === "string" ? token : undefined;
};

const getAdminToken = (headers: Record<string, unknown>) => {
  const token = headers["x-admin-token"];
  return typeof token === "string" ? token : undefined;
};

const serializeClues = (clues: SeedConfig["clues"]) => {
  return [...clues]
    .sort((a, b) => a.order_index - b.order_index)
    .map((clue, index) => ({
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
};

const seedConfigUploadSchema = z.object({
  source: z.enum(["test", "production"]),
  seedConfig: z.unknown()
});

type GameStatus = "PENDING" | "RUNNING" | "PAUSED" | "ENDED";
type MutationPolicyAction = "PLAYER_GAMEPLAY_MUTATION" | "ADMIN_LIVE_OPS_MUTATION";

const mutationPolicyMatrix: Record<GameStatus, Record<MutationPolicyAction, boolean>> = {
  PENDING: {
    PLAYER_GAMEPLAY_MUTATION: false,
    ADMIN_LIVE_OPS_MUTATION: false
  },
  RUNNING: {
    PLAYER_GAMEPLAY_MUTATION: true,
    ADMIN_LIVE_OPS_MUTATION: true
  },
  PAUSED: {
    PLAYER_GAMEPLAY_MUTATION: false,
    ADMIN_LIVE_OPS_MUTATION: true
  },
  ENDED: {
    PLAYER_GAMEPLAY_MUTATION: false,
    ADMIN_LIVE_OPS_MUTATION: false
  }
};

type IdempotencyCacheEntry = {
  requestHash: string;
  statusCode: number;
  payload: unknown;
};

type IdempotencyResolution =
  | { replayed: true }
  | {
      replayed: false;
      cache: (statusCode: number, payload: unknown) => void;
    };

const idempotencyCache = new Map<string, IdempotencyCacheEntry>();

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }

  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const sortedKeys = Object.keys(objectValue).sort((a, b) => a.localeCompare(b));
    const output: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      output[key] = canonicalize(objectValue[key]);
    }
    return output;
  }

  return value;
};

const computeIdempotencyHash = (req: Request) => {
  const normalizedPayload = canonicalize({
    params: req.params,
    query: req.query,
    body: req.body ?? null
  });

  return createHash("sha256").update(JSON.stringify(normalizedPayload)).digest("hex");
};

const resolveIdempotency = (
  req: Request,
  res: Response,
  scope: string
): IdempotencyResolution | null => {
  const rawHeader = req.headers["x-idempotency-key"];
  const idempotencyKey = Array.isArray(rawHeader)
    ? rawHeader[0]?.trim() ?? ""
    : typeof rawHeader === "string"
      ? rawHeader.trim()
      : "";

  if (!idempotencyKey) {
    res.status(400).json({ error: "x-idempotency-key header is required for this operation." });
    return null;
  }

  const requestHash = computeIdempotencyHash(req);
  const cacheKey = `${scope}:${idempotencyKey}`;
  const existing = idempotencyCache.get(cacheKey);

  if (existing) {
    if (existing.requestHash !== requestHash) {
      res.status(409).json({ error: "Idempotency key already used with a different request payload." });
      return null;
    }

    res.status(existing.statusCode).json(existing.payload);
    return { replayed: true };
  }

  return {
    replayed: false,
    cache: (statusCode, payload) => {
      idempotencyCache.set(cacheKey, { requestHash, statusCode, payload });
    }
  };
};

const enforceMutationPolicy = (
  res: Response,
  gameEngine: GameEngine,
  action: MutationPolicyAction,
  operation: string
) => {
  const status = gameEngine.getGameStatus().status as GameStatus;
  const allowed = mutationPolicyMatrix[status]?.[action] ?? false;
  if (allowed) {
    return true;
  }

  res.status(423).json({
    error: `${operation} is blocked while game status is ${status}.`,
    status,
    operation
  });
  return false;
};

export const gameRouter = (gameEngine: GameEngine, aiJudge: AIJudgeProvider) => {
  const router = Router();

  router.post("/auth/join", (req, res) => {
    const joinCode = typeof req.body?.joinCode === "string" ? req.body.joinCode.trim() : "";
    const displayName = typeof req.body?.displayName === "string" ? req.body.displayName.trim() : "";
    const captainPin = typeof req.body?.captainPin === "string" ? req.body.captainPin.trim() : undefined;

    if (!joinCode || !displayName) {
      return res.status(400).json({ error: "joinCode and displayName are required." });
    }

    const result = gameEngine.joinTeam(joinCode, displayName, captainPin);
    if ("error" in result) {
      return res.status(401).json(result);
    }

    return res.status(200).json(result);
  });

  router.get("/join/options", (_req, res) => {
    return res.status(200).json({ teams: gameEngine.getJoinOptions() });
  });

  router.post("/auth/admin/login", (req, res) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const result = gameEngine.loginAdmin(password, env.ADMIN_PASSWORD);
    if (!result) {
      return res.status(401).json({ error: "Invalid admin password." });
    }
    return res.status(200).json(result);
  });

  router.get("/game/status", (_req, res) => {
    return res.json(gameEngine.getGameStatus());
  });

  router.post("/game/status", async (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) {
      return res.status(401).json({ error: "Admin token required." });
    }

    const idempotency = resolveIdempotency(req, res, "admin:game-status");
    if (!idempotency) {
      return;
    }
    if (idempotency.replayed) {
      return;
    }

    const status = req.body?.status;
    if (status !== "PENDING" && status !== "RUNNING" && status !== "PAUSED" && status !== "ENDED") {
      return res.status(400).json({ error: "Invalid game status." });
    }

    const next = await gameEngine.setGameStatus(status);
    idempotency.cache(200, next);
    const io = req.app.get("io") as Server | undefined;
    io?.emit("game:status_changed", next);
    return res.json(next);
  });

  router.post("/admin/join-lock/toggle", (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) {
      return res.status(401).json({ error: "Admin token required." });
    }
    const next = gameEngine.toggleJoinLock();
    const io = req.app.get("io") as Server | undefined;
    io?.emit("game:status_changed", next);
    return res.json(next);
  });

  router.get("/leaderboard", (_req, res) => {
    return res.json({ teams: gameEngine.getLeaderboard() });
  });

  router.get("/team/me/state", (req, res) => {
    const authToken = getAuthToken(req.headers as Record<string, unknown>);
    const session = gameEngine.getSession(authToken);
    if (!session) {
      return res.status(401).json({ error: "Auth token required." });
    }

    const state = gameEngine.getTeamState(session.teamId);
    if (!state) {
      return res.status(404).json({ error: "Team not found." });
    }
    return res.json(state);
  });

  router.get("/team/me/event-feed", (req, res) => {
    const authToken = getAuthToken(req.headers as Record<string, unknown>);
    const session = gameEngine.getSession(authToken);
    if (!session) {
      return res.status(401).json({ error: "Auth token required." });
    }

    const limit = parseLimit(req.query.limit, 100, 500);
    const offset = parseOffset(req.query.offset, 0, 10000);
    const items = gameEngine.getTeamEventFeed(session.teamId, limit, offset);
    if (!items) {
      return res.status(404).json({ error: "Team not found." });
    }

    return res.json(items);
  });

  router.get("/team/me/submissions", (req, res) => {
    const authToken = getAuthToken(req.headers as Record<string, unknown>);
    const session = gameEngine.getSession(authToken);
    if (!session) {
      return res.status(401).json({ error: "Auth token required." });
    }

    const limit = parseLimit(req.query.limit, 50, 500);
    const offset = parseOffset(req.query.offset, 0, 10000);
    const items = gameEngine.getTeamSubmissions(session.teamId, limit, offset);
    if (!items) {
      return res.status(404).json({ error: "Team not found." });
    }

    return res.json(items);
  });

  router.post("/team/me/scan-session", (req, res) => {
    const authToken = getAuthToken(req.headers as Record<string, unknown>);
    const session = gameEngine.getSession(authToken);
    if (!session) {
      return res.status(401).json({ error: "Auth token required." });
    }

    if (!enforceMutationPolicy(res, gameEngine, "PLAYER_GAMEPLAY_MUTATION", "scan-session")) {
      return;
    }

    const result = gameEngine.createScanSession(session.teamId);
    if ("error" in result) {
      return res.status(400).json(result);
    }

    return res.status(200).json(result);
  });

  router.post("/team/me/scan-validate", async (req, res) => {
    const authToken = getAuthToken(req.headers as Record<string, unknown>);
    const session = gameEngine.getSession(authToken);
    if (!session) {
      return res.status(401).json({ error: "Auth token required." });
    }

    if (!enforceMutationPolicy(res, gameEngine, "PLAYER_GAMEPLAY_MUTATION", "scan-validate")) {
      return;
    }

    const scanSessionToken = typeof req.body?.scanSessionToken === "string" ? req.body.scanSessionToken : "";
    const checkpointPublicId = typeof req.body?.checkpointPublicId === "string" ? req.body.checkpointPublicId : "";

    if (!scanSessionToken || !checkpointPublicId) {
      return res.status(400).json({ error: "scanSessionToken and checkpointPublicId are required." });
    }

    const result = await gameEngine.validateScan(session.teamId, scanSessionToken, checkpointPublicId);
    if ("error" in result) {
      return res.status(400).json(result);
    }

    return res.status(200).json(result);
  });

  router.post("/team/me/submit", async (req, res) => {
    const authToken = getAuthToken(req.headers as Record<string, unknown>);
    const session = gameEngine.getSession(authToken);
    if (!session) {
      return res.status(401).json({ error: "Auth token required." });
    }
    if (session.role !== "CAPTAIN") {
      return res.status(403).json({ error: "Only captains may submit clues." });
    }

    if (!enforceMutationPolicy(res, gameEngine, "PLAYER_GAMEPLAY_MUTATION", "submit")) {
      return;
    }

    const clue = gameEngine.getCurrentClue(session.teamId);
    if (!clue) {
      return res.status(404).json({ error: "Current clue not found." });
    }

    const judgment = await aiJudge.judge({
      clueTitle: clue.title,
      clueInstructions: clue.instructions,
      clueRubric: clue.ai_rubric,
      submissionType: clue.submission_type,
      textContent: req.body?.textContent,
      mediaUrl: req.body?.mediaUrl,
      expectedAnswer: clue.expected_answer
    });

    const result = await gameEngine.submitCurrentClue(session.teamId, {
      textContent: req.body?.textContent,
      mediaUrl: req.body?.mediaUrl
    }, judgment.verdict, judgment.score, judgment.reasons);
    if ("error" in result) {
      return res.status(400).json(result);
    }

    const io = req.app.get("io") as Server | undefined;
    const state = gameEngine.getTeamState(session.teamId);
    if (result.verdict === "PASS") {
      io?.to(session.teamId).emit("team:clue_advanced", {
        teamId: session.teamId,
        currentClueIndex: state?.currentClueIndex
      });
      io?.emit("leaderboard:updated", { teams: gameEngine.getLeaderboard() });
      io?.to(session.teamId).emit("submission:verdict_ready", { teamId: session.teamId, verdict: result.verdict });
    }

    if (result.verdict === "NEEDS_REVIEW") {
      io?.emit("submission:needs_review", { teamId: session.teamId, submissionId: result.submissionId });
    }

    return res.status(200).json({ ...result, ai: judgment, teamState: state });
  });

  router.post("/team/me/pass", async (req, res) => {
    const authToken = getAuthToken(req.headers as Record<string, unknown>);
    const session = gameEngine.getSession(authToken);
    if (!session) {
      return res.status(401).json({ error: "Auth token required." });
    }
    if (session.role !== "CAPTAIN") {
      return res.status(403).json({ error: "Only captains may pass clues." });
    }

    if (!enforceMutationPolicy(res, gameEngine, "PLAYER_GAMEPLAY_MUTATION", "pass")) {
      return;
    }

    const result = await gameEngine.passCurrentClue(session.teamId);
    if ("error" in result) {
      return res.status(400).json(result);
    }

    const io = req.app.get("io") as Server | undefined;
    const state = gameEngine.getTeamState(session.teamId);
    io?.to(session.teamId).emit("team:clue_advanced", {
      teamId: session.teamId,
      currentClueIndex: state?.currentClueIndex
    });

    return res.status(200).json({ ...result, teamState: state });
  });

  router.post("/team/me/security-events", async (req, res) => {
    const authToken = getAuthToken(req.headers as Record<string, unknown>);
    const session = gameEngine.getSession(authToken);
    if (!session) {
      return res.status(401).json({ error: "Auth token required." });
    }

    const type = req.body?.type === "SCREENSHOT_ATTEMPT" ? "SCREENSHOT_ATTEMPT" : "OTHER";
    const clueIndex = typeof req.body?.clueIndex === "number" ? req.body.clueIndex : 0;
    const deviceInfo = typeof req.body?.deviceInfo === "string" ? req.body.deviceInfo : undefined;

    const result = await gameEngine.recordSecurityEvent(session.teamId, {
      type,
      clueIndex,
      deviceInfo,
      participantName: session.displayName
    });
    if ("error" in result) {
      return res.status(400).json(result);
    }

    const io = req.app.get("io") as Server | undefined;
    io?.emit("security:screenshot_alert", result);

    return res.status(200).json(result);
  });

  router.get("/admin/review-queue", (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) {
      return res.status(401).json({ error: "Admin token required." });
    }

    const limit = parseLimit(req.query.limit, 100, 500);
    const offset = parseOffset(req.query.offset, 0, 10000);

    return res.json(gameEngine.getReviewQueue(limit, offset));
  });

  router.post("/admin/review/:reviewId/resolve", async (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) {
      return res.status(401).json({ error: "Admin token required." });
    }

    const reviewId = req.params.reviewId;
    const verdict = req.body?.verdict;
    const pointsAwarded = typeof req.body?.pointsAwarded === "number" ? req.body.pointsAwarded : undefined;

    if (verdict !== "PASS" && verdict !== "FAIL") {
      return res.status(400).json({ error: "verdict must be PASS or FAIL." });
    }

    const result = await gameEngine.resolveReviewItem(reviewId, verdict, pointsAwarded);
    if ("error" in result) {
      return res.status(404).json(result);
    }

    const io = req.app.get("io") as Server | undefined;
    io?.to(result.teamId).emit("submission:verdict_ready", {
      teamId: result.teamId,
      verdict: result.verdict,
      pointsAwarded: result.pointsAwarded
    });
    if (result.verdict === "PASS") {
      io?.to(result.teamId).emit("team:clue_advanced", {
        teamId: result.teamId,
        currentClueIndex: result.currentClueIndex
      });
      io?.emit("leaderboard:updated", { teams: gameEngine.getLeaderboard() });
    }

    return res.status(200).json(result);
  });

  router.get("/admin/security-events", (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) {
      return res.status(401).json({ error: "Admin token required." });
    }

    const limit = parseLimit(req.query.limit, 100, 500);
    const offset = parseOffset(req.query.offset, 0, 10000);

    return res.json(gameEngine.getSecurityEvents(limit, offset));
  });

  router.get("/admin/audit-logs", (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) {
      return res.status(401).json({ error: "Admin token required." });
    }

    const limit = parseLimit(req.query.limit, 100, 500);
    const offset = parseOffset(req.query.offset, 0, 10000);

    return res.json(gameEngine.getAuditLogs(limit, offset));
  });

  router.get("/admin/team-assignments", (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) {
      return res.status(401).json({ error: "Admin token required." });
    }

    return res.json({ teams: gameEngine.getAdminTeamAssignments() });
  });

  router.post("/admin/team-assignments/assign", async (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) {
      return res.status(401).json({ error: "Admin token required." });
    }

    const idempotency = resolveIdempotency(req, res, "admin:team-assignment-assign");
    if (!idempotency) {
      return;
    }
    if (idempotency.replayed) {
      return;
    }

    const teamId = typeof req.body?.teamId === "string" ? req.body.teamId.trim() : "";
    const participantName = typeof req.body?.participantName === "string" ? req.body.participantName.trim() : "";
    const result = await gameEngine.assignParticipantToTeam(teamId, participantName);
    if ("error" in result) {
      return res.status(400).json(result);
    }

    idempotency.cache(200, result);
    return res.status(200).json(result);
  });

  router.post("/admin/team-assignments/remove", async (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) {
      return res.status(401).json({ error: "Admin token required." });
    }

    const teamId = typeof req.body?.teamId === "string" ? req.body.teamId.trim() : "";
    const participantName = typeof req.body?.participantName === "string" ? req.body.participantName.trim() : "";
    const result = await gameEngine.removeParticipantFromTeam(teamId, participantName);
    if ("error" in result) {
      return res.status(400).json(result);
    }

    return res.status(200).json(result);
  });

  router.post("/admin/team-assignments/captain", async (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) {
      return res.status(401).json({ error: "Admin token required." });
    }

    const idempotency = resolveIdempotency(req, res, "admin:team-assignment-captain");
    if (!idempotency) {
      return;
    }
    if (idempotency.replayed) {
      return;
    }

    const teamId = typeof req.body?.teamId === "string" ? req.body.teamId.trim() : "";
    const captainName = typeof req.body?.captainName === "string" ? req.body.captainName.trim() : "";
    const captainPin = typeof req.body?.captainPin === "string" ? req.body.captainPin.trim() : "";
    const forceOverride = req.body?.forceOverride === true;
    const result = await gameEngine.assignCaptainToTeam(teamId, captainName, captainPin, forceOverride);
    if ("error" in result) {
      return res.status(400).json(result);
    }

    idempotency.cache(200, result);
    return res.status(200).json(result);
  });

  router.post("/admin/team/:teamId/deduct", async (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) {
      return res.status(401).json({ error: "Admin token required." });
    }

    if (!enforceMutationPolicy(res, gameEngine, "ADMIN_LIVE_OPS_MUTATION", "deduct-points")) {
      return;
    }

    const idempotency = resolveIdempotency(req, res, "admin:team-deduct");
    if (!idempotency) {
      return;
    }
    if (idempotency.replayed) {
      return;
    }

    const teamId = req.params.teamId;
    const amount = typeof req.body?.amount === "number" ? req.body.amount : 0;
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
    if (!reason) {
      return res.status(400).json({ error: "reason is required." });
    }

    const result = await gameEngine.deductTeamPoints(teamId, amount, reason);
    if ("error" in result) {
      return res.status(400).json(result);
    }

    idempotency.cache(200, result);

    const io = req.app.get("io") as Server | undefined;
    io?.emit("leaderboard:updated", { teams: gameEngine.getLeaderboard() });

    return res.status(200).json(result);
  });

  router.post("/admin/team/:teamId/award", async (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) {
      return res.status(401).json({ error: "Admin token required." });
    }

    if (!enforceMutationPolicy(res, gameEngine, "ADMIN_LIVE_OPS_MUTATION", "award-points")) {
      return;
    }

    const teamId = req.params.teamId;
    const amount = typeof req.body?.amount === "number" ? req.body.amount : 0;
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
    if (!reason) {
      return res.status(400).json({ error: "reason is required." });
    }

    const result = await gameEngine.awardTeamPoints(teamId, amount, reason);
    if ("error" in result) {
      return res.status(400).json(result);
    }

    const io = req.app.get("io") as Server | undefined;
    io?.emit("leaderboard:updated", { teams: gameEngine.getLeaderboard() });

    return res.status(200).json(result);
  });

  router.post("/admin/team/:teamId/hint", async (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) {
      return res.status(401).json({ error: "Admin token required." });
    }

    if (!enforceMutationPolicy(res, gameEngine, "ADMIN_LIVE_OPS_MUTATION", "send-hint")) {
      return;
    }

    const teamId = req.params.teamId;
    const clueIndex = typeof req.body?.clueIndex === "number" ? req.body.clueIndex : -1;
    const hintText = typeof req.body?.hintText === "string" ? req.body.hintText : "";

    if (clueIndex < 0) {
      return res.status(400).json({ error: "clueIndex is required." });
    }

    const result = await gameEngine.recordAdminHint(teamId, clueIndex, hintText);
    if ("error" in result) {
      return res.status(400).json(result);
    }

    const io = req.app.get("io") as Server | undefined;
    io?.to(teamId).emit("admin:hint", { clueIndex: result.clueIndex, hintText: result.hintText });

    return res.status(200).json(result);
  });

  router.post("/admin/broadcast", (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) {
      return res.status(401).json({ error: "Admin token required." });
    }

    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message) {
      return res.status(400).json({ error: "message is required." });
    }

    const io = req.app.get("io") as Server | undefined;
    io?.emit("admin:broadcast", { message, sentAt: new Date().toISOString() });

    return res.status(200).json({ message, sentAt: new Date().toISOString() });
  });

  router.post("/admin/reset-seed", async (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) {
      return res.status(401).json({ error: "Admin token required." });
    }

    const variant = req.body?.variant;
    if (variant !== "test" && variant !== "production") {
      return res.status(400).json({ error: "variant must be 'test' or 'production'." });
    }

    const result = await gameEngine.resetToVariant(variant);
    console.log(`[reset-seed] variant=${result.variant} source=${result.resolvedSource} clues=${result.clueCount}`);
    return res.status(200).json(result);
  });

  router.post("/admin/restart", (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) {
      return res.status(401).json({ error: "Admin token required." });
    }

    res.status(200).json({ message: "Server restarting in 1s…" });
    setTimeout(() => process.exit(0), 1000);
  });

  router.post("/admin/team/:teamId/reopen-clue", async (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) {
      return res.status(401).json({ error: "Admin token required." });
    }

    if (!enforceMutationPolicy(res, gameEngine, "ADMIN_LIVE_OPS_MUTATION", "reopen-clue")) {
      return;
    }

    const idempotency = resolveIdempotency(req, res, "admin:team-reopen-clue");
    if (!idempotency) {
      return;
    }
    if (idempotency.replayed) {
      return;
    }

    const teamId = req.params.teamId;
    const clueIndex = typeof req.body?.clueIndex === "number" ? req.body.clueIndex : -1;
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
    const durationSeconds = typeof req.body?.durationSeconds === "number" ? req.body.durationSeconds : undefined;
    if (!reason) {
      return res.status(400).json({ error: "reason is required." });
    }

    const result = await gameEngine.reopenTeamClue(teamId, clueIndex, reason, durationSeconds);
    if ("error" in result) {
      return res.status(400).json(result);
    }

    idempotency.cache(200, result);

    const io = req.app.get("io") as Server | undefined;
    io?.to(teamId).emit("admin:clue_reopened", result);

    return res.status(200).json(result);
  });

  router.post("/admin/scan-sessions/invalidate", async (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) {
      return res.status(401).json({ error: "Admin token required." });
    }

    if (!enforceMutationPolicy(res, gameEngine, "ADMIN_LIVE_OPS_MUTATION", "invalidate-scan-sessions")) {
      return;
    }

    const teamId = typeof req.body?.teamId === "string" ? req.body.teamId : undefined;
    const result = await gameEngine.invalidateScanSessions(teamId);
    return res.status(200).json(result);
  });

  router.post("/admin/clues/:clueIndex/rotate-qr", async (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) {
      return res.status(401).json({ error: "Admin token required." });
    }

    if (!enforceMutationPolicy(res, gameEngine, "ADMIN_LIVE_OPS_MUTATION", "rotate-qr")) {
      return;
    }

    const clueIndex = Number(req.params.clueIndex);
    const qrPublicId = typeof req.body?.qrPublicId === "string" ? req.body.qrPublicId : undefined;
    const result = await gameEngine.rotateClueQrPublicId(clueIndex, qrPublicId);
    if ("error" in result) {
      return res.status(400).json(result);
    }

    const io = req.app.get("io") as Server | undefined;
    io?.emit("admin:qr_rotated", result);
    return res.status(200).json(result);
  });

  router.get("/admin/clues", (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) {
      return res.status(401).json({ error: "Admin token required." });
    }

    const source = req.query.source;
    if (source !== undefined && source !== "test" && source !== "production") {
      return res.status(400).json({ error: "source must be 'test' or 'production'." });
    }

    if (source === "test" || source === "production") {
      const selectedSource = source as SeedConfigVariant;
      const loaded = loadSeedConfigVariant(selectedSource);
      return res.json({
        clues: serializeClues(loaded.seed.clues),
        requestedSource: selectedSource,
        resolvedSource: loaded.resolvedSource,
        fallbackToDefault: loaded.fallbackToDefault,
        sourceFile: loaded.sourceFile
      });
    }

    return res.json({
      clues: gameEngine.getAllClues(),
      requestedSource: "active",
      resolvedSource: "active",
      fallbackToDefault: false
    });
  });

  router.get("/admin/clues/template", (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) {
      return res.status(401).json({ error: "Admin token required." });
    }

    const source = req.query.source;
    if (source !== undefined && source !== "test" && source !== "production") {
      return res.status(400).json({ error: "source must be 'test' or 'production'." });
    }

    const requestedSource = (source === "test" || source === "production") ? (source as SeedConfigVariant) : "production";
    const loaded = loadSeedConfigVariant(requestedSource);

    return res.json({
      requestedSource,
      resolvedSource: loaded.resolvedSource,
      fallbackToDefault: loaded.fallbackToDefault,
      sourceFile: loaded.sourceFile,
      seedConfig: loaded.seed
    });
  });

  router.post("/admin/clues/upload", (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) {
      return res.status(401).json({ error: "Admin token required." });
    }

    const parsed = seedConfigUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid seed upload payload." });
    }

    let normalizedSeedConfig: SeedConfig;
    try {
      normalizedSeedConfig = normalizeSeedConfig(parsed.data.seedConfig, loadSeedConfig());
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return res.status(400).json({ error: `Unsupported seed config format: ${reason}` });
    }

    const saveResult = saveSeedConfigVariant(parsed.data.source as SeedConfigVariant, normalizedSeedConfig);
    return res.json({
      source: parsed.data.source,
      clueCount: saveResult.clueCount,
      sourceFile: saveResult.sourceFile
    });
  });

  // ── Public website events ────────────────────────────────────────
  // In-memory store; persists for the lifetime of the process.
  // Survives redeployments only if written to the seed/config layer.
  // For game-day use, this is sufficient.

  type EventCategory = "hunt" | "meal" | "activity" | "transport" | "other";
  type EventResult = { teamId: string; place: 1 | 2 | 3; pointsAwarded: number };
  type EventRecord = {
    id: string;
    title: string;
    description: string;
    date: string;
    time: string;
    location: string;
    category: EventCategory;
    sortOrder: number;
    // Scoring
    basePoints: number;       // points for participation / completion
    weight: number;           // multiplier applied to basePoints (default 1.0)
    firstPlaceBonus: number;  // flat bonus on top of weighted base for 1st
    secondPlaceBonus: number;
    thirdPlaceBonus: number;
    results: EventResult[];   // recorded placements
  };

  const VALID_CATS: EventCategory[] = ["hunt","meal","activity","transport","other"];

  const parsePoints = (v: unknown, fallback = 0) =>
    Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : fallback;
  const parseWeight = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 1;
  };

  const buildEvent = (body: Record<string, unknown>, base?: EventRecord): EventRecord => {
    const now = base ?? {} as Partial<EventRecord>;
    return {
      id: (now.id as string) ?? crypto.randomUUID(),
      title: body.title !== undefined ? String(body.title).trim() : (now.title ?? ""),
      description: body.description !== undefined ? String(body.description).trim() : (now.description ?? ""),
      date: body.date !== undefined ? String(body.date).trim() : (now.date ?? ""),
      time: body.time !== undefined ? String(body.time).trim() : (now.time ?? ""),
      location: body.location !== undefined ? String(body.location).trim() : (now.location ?? ""),
      category: (body.category !== undefined && VALID_CATS.includes(body.category as EventCategory)
        ? body.category as EventCategory
        : (now.category ?? "other")),
      sortOrder: body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))
        ? Number(body.sortOrder)
        : (now.sortOrder ?? eventsStore.length),
      basePoints:        body.basePoints !== undefined        ? parsePoints(body.basePoints)        : (now.basePoints        ?? 0),
      weight:            body.weight !== undefined            ? parseWeight(body.weight)             : (now.weight            ?? 1),
      firstPlaceBonus:   body.firstPlaceBonus !== undefined   ? parsePoints(body.firstPlaceBonus)   : (now.firstPlaceBonus   ?? 0),
      secondPlaceBonus:  body.secondPlaceBonus !== undefined  ? parsePoints(body.secondPlaceBonus)  : (now.secondPlaceBonus  ?? 0),
      thirdPlaceBonus:   body.thirdPlaceBonus !== undefined   ? parsePoints(body.thirdPlaceBonus)   : (now.thirdPlaceBonus   ?? 0),
      results: base?.results ?? [],
    };
  };

  // Points a team earns for a given place in this event:
  //   basePoints * weight  +  placeBonus
  const calcPoints = (ev: EventRecord, place: 1 | 2 | 3): number => {
    const bonus = place === 1 ? ev.firstPlaceBonus : place === 2 ? ev.secondPlaceBonus : ev.thirdPlaceBonus;
    return Math.round(ev.basePoints * ev.weight + bonus);
  };

  // ── Events persistence ───────────────────────────────────────────
  // Persists to /data/events-store.json (Railway volume) if that directory
  // exists, otherwise falls back to the process working directory.
  // Mount a Railway Volume at /data on the backend service for full
  // cross-deployment persistence.
  const eventsFilePath = (() => {
    const railwayVolume = "/data";
    const dir = fs.existsSync(railwayVolume) ? railwayVolume : path.resolve(process.cwd());
    return path.join(dir, "events-store.json");
  })();

  const saveEventsToDisk = (store: EventRecord[]): void => {
    try {
      fs.writeFileSync(eventsFilePath, JSON.stringify(store, null, 2), "utf-8");
    } catch {
      console.warn("[events] Could not write events-store.json:", eventsFilePath);
    }
  };

  const loadEventsFromDisk = (): EventRecord[] => {
    // 1. Try runtime store (persists while container lives, or across redeploys if /data volume is mounted)
    try {
      if (fs.existsSync(eventsFilePath)) {
        const raw = JSON.parse(fs.readFileSync(eventsFilePath, "utf-8"));
        if (Array.isArray(raw) && raw.length > 0) return raw as EventRecord[];
      }
    } catch { /* ignore */ }
    // 2. Fall back to seed file baked into the image
    const seedCandidates = [
      path.resolve(process.cwd(), "events-seed.json"),
      path.resolve(process.cwd(), "..", "events-seed.json"),
    ];
    for (const p of seedCandidates) {
      try {
        if (fs.existsSync(p)) {
          const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
          if (Array.isArray(raw) && raw.length > 0) {
            console.log("[events] Loaded", raw.length, "events from seed file:", p);
            saveEventsToDisk(raw as EventRecord[]);
            return raw as EventRecord[];
          }
        }
      } catch { /* ignore */ }
    }
    return [];
  };

  const eventsStore: EventRecord[] = loadEventsFromDisk();

  router.get("/events", (_req, res) => {
    const sorted = [...eventsStore].sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`);
    });
    return res.json({ events: sorted });
  });

  router.post("/admin/events", (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) return res.status(401).json({ error: "Admin token required." });
    const body = req.body ?? {};
    if (!String(body.title ?? "").trim() || !String(body.location ?? "").trim()) {
      return res.status(400).json({ error: "title and location are required." });
    }
    const event = buildEvent(body);
    eventsStore.push(event);
    saveEventsToDisk(eventsStore);
    return res.status(201).json(event);
  });

  router.put("/admin/events/:id", (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) return res.status(401).json({ error: "Admin token required." });
    const idx = eventsStore.findIndex((e) => e.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Event not found." });
    eventsStore[idx] = buildEvent(req.body ?? {}, eventsStore[idx]);
    saveEventsToDisk(eventsStore);
    return res.json(eventsStore[idx]);
  });

  router.delete("/admin/events/:id", (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) return res.status(401).json({ error: "Admin token required." });
    const idx = eventsStore.findIndex((e) => e.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Event not found." });
    eventsStore.splice(idx, 1);
    saveEventsToDisk(eventsStore);
    return res.status(204).send();
  });

  // ── Record results for an event (admin) ─────────────────────────
  // Body: { results: [{ teamId, place }, ...] }
  // place must be 1, 2, or 3.  Replaces any existing results for this event.
  // Also awards points to the team score via gameEngine.
  router.post("/admin/events/:id/results", async (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) return res.status(401).json({ error: "Admin token required." });
    const idx = eventsStore.findIndex((e) => e.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Event not found." });
    const ev = eventsStore[idx];
    const incoming: Array<{ teamId: unknown; place: unknown }> = Array.isArray(req.body?.results) ? req.body.results : [];

    // Revoke previously awarded event points from this event (if any)
    for (const prev of ev.results) {
      if (prev.pointsAwarded > 0) {
        await gameEngine.deductTeamPoints(prev.teamId, prev.pointsAwarded, `Event result revoked: ${ev.title}`);
      }
    }

    const newResults: EventResult[] = [];
    const errors: string[] = [];
    for (const entry of incoming) {
      const teamId = String(entry.teamId ?? "").trim().toLowerCase();
      const place = Number(entry.place);
      if (!teamId) { errors.push("Missing teamId"); continue; }
      if (![1, 2, 3].includes(place)) { errors.push(`Invalid place ${place} for ${teamId}`); continue; }
      const pts = calcPoints(ev, place as 1 | 2 | 3);
      newResults.push({ teamId, place: place as 1 | 2 | 3, pointsAwarded: pts });
      if (pts > 0) {
        const r = await gameEngine.awardTeamPoints(teamId, pts, `Event result: ${ev.title} — place ${place}`);
        if (r && "error" in r) errors.push(`${teamId}: ${r.error}`);
      }
    }

    eventsStore[idx] = { ...ev, results: newResults };
    saveEventsToDisk(eventsStore);
    return res.json({ event: eventsStore[idx], errors });
  });

  // ── Bulk events import ───────────────────────────────────────────
  router.post("/admin/events/bulk", (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) return res.status(401).json({ error: "Admin token required." });
    const { events: incoming, replace = false } = req.body ?? {};
    if (!Array.isArray(incoming)) return res.status(400).json({ error: "Body must be { events: [...], replace?: boolean }" });
    const created: string[] = [];
    const skipped: string[] = [];
    if (replace) eventsStore.splice(0);
    for (const ev of incoming) {
      if (!String(ev?.title ?? "").trim() || !String(ev?.location ?? "").trim()) {
        skipped.push(String(ev?.title ?? "?")); continue;
      }
      eventsStore.push(buildEvent(ev as Record<string, unknown>));
      created.push(String(ev.title).trim());
    }
    saveEventsToDisk(eventsStore);
    return res.json({ created: created.length, skipped: skipped.length, skippedTitles: skipped });
  });

  // ── Bulk team import ─────────────────────────────────────────────
  // Accepts:
  //   { spades: { members: [...], captain: "Name", pin: "123456" }, hearts: {...}, ... }
  // All fields optional; members array replaces (adds) to existing roster.
  // Set replace=true to clear each team's roster before adding.
  router.post("/admin/team-assignments/bulk", async (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) {
      return res.status(401).json({ error: "Admin token required." });
    }
    const { teams, replace = false } = req.body ?? {};
    if (!teams || typeof teams !== "object" || Array.isArray(teams)) {
      return res.status(400).json({ error: "Body must be { teams: { spades: {...}, ... }, replace?: boolean }" });
    }
    const results: Record<string, { added: string[]; captain?: string; errors: string[] }> = {};
    for (const [rawTeamId, teamData] of Object.entries(teams)) {
      const teamId = String(rawTeamId).trim().toLowerCase();
      const data = teamData as { members?: unknown; captain?: unknown; pin?: unknown };
      const teamResult: { added: string[]; captain?: string; errors: string[] } = { added: [], errors: [] };
      results[teamId] = teamResult;

      // Clear roster first if replace mode
      if (replace) {
        const current = gameEngine.getAdminTeamAssignments().find((t) => t.teamId.toLowerCase() === teamId);
        if (current) {
          for (const name of [...current.assignedParticipants]) {
            await gameEngine.removeParticipantFromTeam(teamId, name);
          }
        }
      }

      // Add members
      if (Array.isArray(data.members)) {
        for (const m of data.members) {
          const name = String(m).trim();
          if (!name) continue;
          const r = await gameEngine.assignParticipantToTeam(teamId, name);
          if ("error" in r) teamResult.errors.push(`${name}: ${r.error}`);
          else teamResult.added.push(name);
        }
      }

      // Set captain + PIN if provided
      if (data.captain && data.pin) {
        const r = await gameEngine.assignCaptainToTeam(
          teamId,
          String(data.captain).trim(),
          String(data.pin).trim(),
          false
        );
        if ("error" in r) teamResult.errors.push(`captain: ${r.error}`);
        else teamResult.captain = String(data.captain).trim();
      }
    }
    return res.json({ results });
  });

  // ── What to Bring (packing list) ────────────────────────────────
  type PackingCategory = "clothing" | "gear" | "documents" | "health" | "other";
  type PackingItem = {
    id: string;
    text: string;
    category: PackingCategory;
    sortOrder: number;
    note: string;
  };

  const VALID_PACKING_CATS: PackingCategory[] = ["clothing","gear","documents","health","other"];

  const packingFilePath = (() => {
    const railwayVolume = "/data";
    const dir = fs.existsSync(railwayVolume) ? railwayVolume : path.resolve(process.cwd());
    return path.join(dir, "packing-store.json");
  })();

  const savePackingToDisk = (store: PackingItem[]): void => {
    try {
      fs.writeFileSync(packingFilePath, JSON.stringify(store, null, 2), "utf-8");
    } catch {
      console.warn("[packing] Could not write packing-store.json:", packingFilePath);
    }
  };

  const loadPackingFromDisk = (): PackingItem[] => {
    // 1. Try runtime store
    try {
      if (fs.existsSync(packingFilePath)) {
        const raw = JSON.parse(fs.readFileSync(packingFilePath, "utf-8"));
        if (Array.isArray(raw) && raw.length > 0) return raw as PackingItem[];
      }
    } catch { /* ignore */ }
    // 2. Fall back to seed file baked into the image
    const seedCandidates = [
      path.resolve(process.cwd(), "packing-seed.json"),
      path.resolve(process.cwd(), "..", "packing-seed.json"),
    ];
    for (const p of seedCandidates) {
      try {
        if (fs.existsSync(p)) {
          const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
          if (Array.isArray(raw) && raw.length > 0) {
            console.log("[packing] Loaded", raw.length, "items from seed file:", p);
            savePackingToDisk(raw as PackingItem[]);
            return raw as PackingItem[];
          }
        }
      } catch { /* ignore */ }
    }
    return [];
  };

  const packingStore: PackingItem[] = loadPackingFromDisk();

  const buildPackingItem = (body: Record<string, unknown>, base?: PackingItem): PackingItem => {
    const now = base ?? {} as Partial<PackingItem>;
    return {
      id: (now.id as string) ?? crypto.randomUUID(),
      text: body.text !== undefined ? String(body.text).trim() : (now.text ?? ""),
      category: (body.category !== undefined && VALID_PACKING_CATS.includes(body.category as PackingCategory)
        ? body.category as PackingCategory
        : (now.category ?? "other")),
      sortOrder: body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))
        ? Number(body.sortOrder)
        : (now.sortOrder ?? packingStore.length),
      note: body.note !== undefined ? String(body.note).trim() : (now.note ?? ""),
    };
  };

  router.get("/packing", (_req, res) => {
    const sorted = [...packingStore].sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.text.localeCompare(b.text);
    });
    return res.json({ items: sorted });
  });

  router.post("/admin/packing", (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) return res.status(401).json({ error: "Admin token required." });
    const body = req.body ?? {};
    if (!String(body.text ?? "").trim()) return res.status(400).json({ error: "text is required." });
    const item = buildPackingItem(body);
    packingStore.push(item);
    savePackingToDisk(packingStore);
    return res.status(201).json(item);
  });

  router.put("/admin/packing/:id", (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) return res.status(401).json({ error: "Admin token required." });
    const idx = packingStore.findIndex((i) => i.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Item not found." });
    packingStore[idx] = buildPackingItem(req.body ?? {}, packingStore[idx]);
    savePackingToDisk(packingStore);
    return res.json(packingStore[idx]);
  });

  router.delete("/admin/packing/:id", (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) return res.status(401).json({ error: "Admin token required." });
    const idx = packingStore.findIndex((i) => i.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Item not found." });
    packingStore.splice(idx, 1);
    savePackingToDisk(packingStore);
    return res.status(204).send();
  });

  // ── Sports Betting ────────────────────────────────────────────────
  // Lock times (PDT = UTC-7)
  const BETTING_THU_LOCK          = new Date("2026-04-10T01:30:00Z"); // Thu Apr 9  6:30 PM PDT
  const BETTING_FRI_GAMES_LOCK    = new Date("2026-04-10T19:00:00Z"); // Fri Apr 10 12:00 PM PDT (NBA/MLB)
  const BETTING_FRI_MASTERS_LOCK  = new Date("2026-04-11T05:00:00Z"); // Fri Apr 10 10:00 PM PDT (Masters/Rory)
  const BETTING_SAT_LOCK          = new Date("2026-04-11T15:00:00Z"); // Sat Apr 11  8:00 AM PDT

  const BETTING_TEAM_IDS = ["spades", "hearts", "diamonds", "clubs"] as const;
  type BettingTeamId = typeof BETTING_TEAM_IDS[number];

  const BETTING_FIELD_LOCKS: Record<string, Date> = {
    thu_nba_1:  BETTING_THU_LOCK,
    fri_nba_1:  BETTING_FRI_GAMES_LOCK,
    fri_nba_2:  BETTING_FRI_GAMES_LOCK,
    fri_mlb_1:  BETTING_FRI_GAMES_LOCK,
    fri_mlb_2:  BETTING_FRI_GAMES_LOCK,
    masters_1:  BETTING_FRI_MASTERS_LOCK,
    masters_2:  BETTING_FRI_MASTERS_LOCK,
    masters_3:  BETTING_FRI_MASTERS_LOCK,
    rory_score: BETTING_FRI_MASTERS_LOCK,
    sat_mlb_1:  BETTING_SAT_LOCK,
    sat_mlb_2:  BETTING_SAT_LOCK,
  };

  type BettingTeamPicks = Partial<Record<string, string>> & { updatedAt?: string };

  type BettingResults = {
    thu_nba_1?: string;
    fri_nba_1?: string;
    fri_nba_2?: string;
    fri_mlb_1?: string;
    fri_mlb_2?: string;
    sat_mlb_1?: string;
    sat_mlb_2?: string;
    masters_total_spades?: number;
    masters_total_hearts?: number;
    masters_total_diamonds?: number;
    masters_total_clubs?: number;
    rory_actual?: number;
  };

  type BettingStore = {
    picks: Partial<Record<BettingTeamId, BettingTeamPicks>>;
    results: BettingResults;
  };

  const bettingFilePath = (() => {
    const railwayVolume = "/data";
    const dir = fs.existsSync(railwayVolume) ? railwayVolume : path.resolve(process.cwd());
    return path.join(dir, "betting-store.json");
  })();

  const saveBettingToDisk = (store: BettingStore): void => {
    try {
      fs.writeFileSync(bettingFilePath, JSON.stringify(store, null, 2), "utf-8");
    } catch {
      console.warn("[betting] Could not write betting-store.json");
    }
  };

  const loadBettingFromDisk = (): BettingStore => {
    try {
      if (fs.existsSync(bettingFilePath)) {
        const raw = JSON.parse(fs.readFileSync(bettingFilePath, "utf-8"));
        if (raw && typeof raw === "object" && raw.picks) return raw as BettingStore;
      }
    } catch { /* ignore */ }
    return { picks: {}, results: {} };
  };

  const bettingStore: BettingStore = loadBettingFromDisk();

  router.get("/sportsbetting", (_req, res) => {
    const now = new Date();
    return res.json({
      picks: bettingStore.picks,
      results: bettingStore.results,
      lockStatus: {
        thursday:   now >= BETTING_THU_LOCK,
        fridayGames:   now >= BETTING_FRI_GAMES_LOCK,
        fridayMasters: now >= BETTING_FRI_MASTERS_LOCK,
        saturday:   now >= BETTING_SAT_LOCK,
      },
      lockTimes: {
        thursday:   BETTING_THU_LOCK.toISOString(),
        fridayGames:   BETTING_FRI_GAMES_LOCK.toISOString(),
        fridayMasters: BETTING_FRI_MASTERS_LOCK.toISOString(),
        saturday:   BETTING_SAT_LOCK.toISOString(),
      },
    });
  });

  router.post("/sportsbetting/picks/:teamId", (req, res) => {
    const teamId = req.params.teamId as BettingTeamId;
    if (!(BETTING_TEAM_IDS as readonly string[]).includes(teamId)) {
      return res.status(400).json({ error: "Invalid team." });
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const now = new Date();
    const existing: BettingTeamPicks = { ...(bettingStore.picks[teamId] ?? {}) };
    const updated: BettingTeamPicks = { ...existing };
    const rejected: string[] = [];

    for (const [field, lockTime] of Object.entries(BETTING_FIELD_LOCKS)) {
      if (body[field] !== undefined) {
        if (now >= lockTime) {
          rejected.push(field);
        } else {
          const val = String(body[field] ?? "").trim();
          if (val) {
            updated[field] = val;
          } else {
            delete updated[field];
          }
        }
      }
    }

    updated.updatedAt = now.toISOString();
    bettingStore.picks[teamId] = updated;
    saveBettingToDisk(bettingStore);
    return res.json({ picks: updated, rejected });
  });

  router.put("/admin/sportsbetting/results", (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) return res.status(401).json({ error: "Admin token required." });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const results: BettingResults = { ...bettingStore.results };

    for (const f of ["thu_nba_1","fri_nba_1","fri_nba_2","fri_mlb_1","fri_mlb_2","sat_mlb_1","sat_mlb_2"] as const) {
      if (body[f] !== undefined) {
        const v = String(body[f] ?? "").trim();
        if (v) results[f] = v; else delete results[f];
      }
    }
    for (const f of ["masters_total_spades","masters_total_hearts","masters_total_diamonds","masters_total_clubs","rory_actual"] as const) {
      if (body[f] !== undefined) {
        const n = Number(body[f]);
        if (Number.isFinite(n)) results[f] = n; else delete results[f];
      }
    }

    bettingStore.results = results;
    saveBettingToDisk(bettingStore);
    return res.json(results);
  });

  return router;
};
