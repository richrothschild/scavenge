import { Router } from "express";
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
      qr_public_id: clue.qr_public_id
    }));
};

const seedConfigUploadSchema = z.object({
  source: z.enum(["test", "production"]),
  seedConfig: z.unknown()
});

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

    const status = req.body?.status;
    if (status !== "PENDING" && status !== "RUNNING" && status !== "PAUSED" && status !== "ENDED") {
      return res.status(400).json({ error: "Invalid game status." });
    }

    const next = await gameEngine.setGameStatus(status);
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

  router.get("/sabotage/catalog", (_req, res) => {
    return res.json({ items: gameEngine.getSabotageCatalog() });
  });

  router.post("/team/me/scan-session", (req, res) => {
    const authToken = getAuthToken(req.headers as Record<string, unknown>);
    const session = gameEngine.getSession(authToken);
    if (!session) {
      return res.status(401).json({ error: "Auth token required." });
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
      mediaUrl: req.body?.mediaUrl
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

    return res.status(200).json({ ...result, ai: judgment });
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

    return res.status(200).json(result);
  });

  router.post("/team/me/sabotage/trigger", async (req, res) => {
    const authToken = getAuthToken(req.headers as Record<string, unknown>);
    const session = gameEngine.getSession(authToken);
    if (!session) {
      return res.status(401).json({ error: "Auth token required." });
    }
    if (session.role !== "CAPTAIN") {
      return res.status(403).json({ error: "Only captains may trigger sabotage." });
    }

    const actionId = typeof req.body?.actionId === "string" ? req.body.actionId : "";
    const targetTeamId = typeof req.body?.targetTeamId === "string" ? req.body.targetTeamId : undefined;
    if (!actionId) {
      return res.status(400).json({ error: "actionId is required." });
    }

    const result = await gameEngine.triggerSabotage(session.teamId, actionId, targetTeamId);
    if ("error" in result) {
      return res.status(400).json(result);
    }

    const io = req.app.get("io") as Server | undefined;
    io?.emit("sabotage:triggered", result);
    return res.status(200).json(result);
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

    const teamId = typeof req.body?.teamId === "string" ? req.body.teamId.trim() : "";
    const participantName = typeof req.body?.participantName === "string" ? req.body.participantName.trim() : "";
    const result = await gameEngine.assignParticipantToTeam(teamId, participantName);
    if ("error" in result) {
      return res.status(400).json(result);
    }

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

  router.post("/admin/team/:teamId/deduct", async (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) {
      return res.status(401).json({ error: "Admin token required." });
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

    const io = req.app.get("io") as Server | undefined;
    io?.emit("leaderboard:updated", { teams: gameEngine.getLeaderboard() });

    return res.status(200).json(result);
  });

  router.post("/admin/team/:teamId/award", async (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) {
      return res.status(401).json({ error: "Admin token required." });
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

    const io = req.app.get("io") as Server | undefined;
    io?.to(teamId).emit("admin:clue_reopened", result);

    return res.status(200).json(result);
  });

  router.post("/admin/scan-sessions/invalidate", async (req, res) => {
    const adminToken = getAdminToken(req.headers as Record<string, unknown>);
    if (!gameEngine.isAdminTokenValid(adminToken)) {
      return res.status(401).json({ error: "Admin token required." });
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

  return router;
};
