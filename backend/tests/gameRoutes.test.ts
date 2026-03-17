import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import request, { SuperTest, Test } from "supertest";
import { AuthRateLimitConfig, createApp } from "../src/app";
import { createAIJudgeProvider } from "../src/services/aiJudge";
import { GameEngine, loadSeedConfig } from "../src/services/gameEngine";
import { MemoryStateStore } from "../src/persistence/stateStore";

type Emission = {
  scope: "all" | "room";
  room?: string;
  event: string;
  payload: unknown;
};

const createIoSpy = () => {
  const emissions: Emission[] = [];
  const io = {
    emit(event: string, payload: unknown) {
      emissions.push({ scope: "all", event, payload });
    },
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          emissions.push({ scope: "room", room, event, payload });
        }
      };
    }
  };
  return { io, emissions };
};

const setup = async () => {
  const seed = loadSeedConfig();
  const gameEngine = await GameEngine.create(seed, new MemoryStateStore());
  const app = createApp(["*"], gameEngine, createAIJudgeProvider("mock"));
  const ioSpy = createIoSpy();
  app.set("io", ioSpy.io);
  const http = request(app);
  return { seed, gameEngine, http, emissions: ioSpy.emissions };
};

const setupWithRateLimits = async (authRateLimitConfig: AuthRateLimitConfig) => {
  const seed = loadSeedConfig();
  const gameEngine = await GameEngine.create(seed, new MemoryStateStore());
  const app = createApp(["*"], gameEngine, createAIJudgeProvider("mock"), authRateLimitConfig);
  const ioSpy = createIoSpy();
  app.set("io", ioSpy.io);
  const http = request(app);
  return { seed, gameEngine, http, emissions: ioSpy.emissions };
};

const teamIdFromJoinCode = (joinCode: string) => joinCode.trim().toUpperCase().split("-")[0]!.toLowerCase();

const resolveVariantPathForTests = (fileName: string) => {
  const roots = [path.resolve(process.cwd(), ".."), path.resolve(process.cwd())];
  const candidates = roots.map((root) => path.resolve(root, fileName));
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
};

const assignParticipant = async (http: SuperTest<Test>, joinCode: string, participantName: string) => {
  const adminToken = await loginAsAdmin(http);
  const response = await http
    .post("/api/admin/team-assignments/assign")
    .set("x-admin-token", adminToken)
    .send({ teamId: teamIdFromJoinCode(joinCode), participantName });
  assert.equal(response.status, 200);
};

const joinAssignedParticipant = async (
  http: SuperTest<Test>,
  joinCode: string,
  displayName: string,
  captainPin?: string
) => {
  await assignParticipant(http, joinCode, displayName);
  const response = await http.post("/api/auth/join").send({
    joinCode,
    displayName,
    captainPin
  });
  assert.equal(response.status, 200);
  return response;
};

const joinAsCaptain = async (http: SuperTest<Test>, joinCode: string, captainPin: string) => {
  const response = await joinAssignedParticipant(http, joinCode, "Captain Tester", captainPin);
  return response.body.session.token as string;
};

const loginAsAdmin = async (http: SuperTest<Test>) => {
  const response = await http.post("/api/auth/admin/login").send({ password: "changeme" });
  assert.equal(response.status, 200);
  return response.body.token as string;
};

const ensureScanIfRequired = async (http: SuperTest<Test>, captainToken: string) => {
  const stateResponse = await http
    .get("/api/team/me/state")
    .set("x-auth-token", captainToken);
  assert.equal(stateResponse.status, 200);

  if (!stateResponse.body.currentClue?.requires_scan) {
    return;
  }

  const scanSessionResponse = await http
    .post("/api/team/me/scan-session")
    .set("x-auth-token", captainToken)
    .send({});
  assert.equal(scanSessionResponse.status, 200);

  const validateResponse = await http
    .post("/api/team/me/scan-validate")
    .set("x-auth-token", captainToken)
    .send({
      scanSessionToken: scanSessionResponse.body.scanSessionToken,
      checkpointPublicId: stateResponse.body.currentClue.qr_public_id
    });
  assert.equal(validateResponse.status, 200);
};

test("member cannot submit clues", async () => {
  const { seed, http } = await setup();
  const team = seed.teams[0];

  const joinResponse = await joinAssignedParticipant(http, team.join_code, "Member Tester");

  assert.equal(joinResponse.body.session.role, "MEMBER");

  const submitResponse = await http
    .post("/api/team/me/submit")
    .set("x-auth-token", joinResponse.body.session.token)
    .send({ textContent: "proof" });

  assert.equal(submitResponse.status, 403);
  assert.match(submitResponse.body.error, /captains/i);
});

test("join endpoint accepts short suit team names", async () => {
  const { seed, http } = await setup();
  const team = seed.teams[0];
  const shortTeamName = team.join_code.split("-")[0];

  const joinResponse = await joinAssignedParticipant(http, shortTeamName, "Suit Login Tester");

  assert.equal(joinResponse.body.team.teamName, team.name);
  assert.equal(joinResponse.body.session.role, "MEMBER");
});

test("join endpoint rejects unassigned participants", async () => {
  const { seed, http } = await setup();
  const team = seed.teams[0];

  const joinResponse = await http.post("/api/auth/join").send({
    joinCode: team.join_code,
    displayName: "Not Assigned"
  });

  assert.equal(joinResponse.status, 401);
  assert.match(joinResponse.body.error, /assigned name/i);
});

test("join options do not expose captain pins", async () => {
  const { http } = await setup();

  const joinOptionsResponse = await http.get("/api/join/options");
  assert.equal(joinOptionsResponse.status, 200);
  assert.ok(Array.isArray(joinOptionsResponse.body.teams));
  assert.equal("captainPin" in joinOptionsResponse.body.teams[0], false);
});

test("admin can assign and move participants between teams", async () => {
  const { seed, http } = await setup();
  const adminToken = await loginAsAdmin(http);
  const firstTeam = seed.teams[0];
  const secondTeam = seed.teams[1];

  const assignFirst = await http
    .post("/api/admin/team-assignments/assign")
    .set("x-admin-token", adminToken)
    .send({ teamId: firstTeam.name.toLowerCase(), participantName: "Roster Tester" });
  assert.equal(assignFirst.status, 200);
  assert.equal(assignFirst.body.movedFromTeamId, null);

  const assignSecond = await http
    .post("/api/admin/team-assignments/assign")
    .set("x-admin-token", adminToken)
    .send({ teamId: secondTeam.name.toLowerCase(), participantName: "Roster Tester" });
  assert.equal(assignSecond.status, 200);
  assert.equal(assignSecond.body.movedFromTeamId, firstTeam.name.toLowerCase());

  const rosterResponse = await http
    .get("/api/admin/team-assignments")
    .set("x-admin-token", adminToken);
  assert.equal(rosterResponse.status, 200);

  const firstRoster = rosterResponse.body.teams.find((entry: { teamId: string }) => entry.teamId === firstTeam.name.toLowerCase());
  const secondRoster = rosterResponse.body.teams.find((entry: { teamId: string }) => entry.teamId === secondTeam.name.toLowerCase());
  assert.ok(firstRoster);
  assert.ok(secondRoster);
  assert.equal(firstRoster.captainPin, firstTeam.captain_pin);
  assert.equal(secondRoster.captainPin, secondTeam.captain_pin);
  assert.ok(!firstRoster.assignedParticipants.includes("Roster Tester"));
  assert.ok(secondRoster.assignedParticipants.includes("Roster Tester"));
});

test("admin can reassign captain and update captain pin", async () => {
  const { seed, http } = await setup();
  const adminToken = await loginAsAdmin(http);
  const targetTeam = seed.teams[0];

  const updateResponse = await http
    .post("/api/admin/team-assignments/captain")
    .set("x-admin-token", adminToken)
    .send({
      teamId: targetTeam.name.toLowerCase(),
      captainName: "Backup Captain",
      captainPin: "123456"
    });
  assert.equal(updateResponse.status, 200);
  assert.equal(updateResponse.body.teamId, targetTeam.name.toLowerCase());
  assert.equal(updateResponse.body.captainName, "Backup Captain");
  assert.equal(updateResponse.body.captainPin, "123456");

  const rosterResponse = await http
    .get("/api/admin/team-assignments")
    .set("x-admin-token", adminToken);
  assert.equal(rosterResponse.status, 200);
  const roster = rosterResponse.body.teams.find((entry: { teamId: string }) => entry.teamId === targetTeam.name.toLowerCase());
  assert.ok(roster);
  assert.equal(roster.captainName, "Backup Captain");
  assert.equal(roster.captainPin, "123456");
  assert.ok(roster.assignedParticipants.includes("Backup Captain"));

  const oldCaptainPinJoin = await http.post("/api/auth/join").send({
    joinCode: targetTeam.join_code,
    displayName: "Backup Captain",
    captainPin: targetTeam.captain_pin
  });
  assert.equal(oldCaptainPinJoin.status, 401);

  const newCaptainPinJoin = await http.post("/api/auth/join").send({
    joinCode: targetTeam.join_code,
    displayName: "Backup Captain",
    captainPin: "123456"
  });
  assert.equal(newCaptainPinJoin.status, 200);
  assert.equal(newCaptainPinJoin.body.session.role, "CAPTAIN");
});

test("captain reassignment validates pin format", async () => {
  const { seed, http } = await setup();
  const adminToken = await loginAsAdmin(http);
  const targetTeam = seed.teams[0];

  const response = await http
    .post("/api/admin/team-assignments/captain")
    .set("x-admin-token", adminToken)
    .send({
      teamId: targetTeam.name.toLowerCase(),
      captainName: "Pin Failure Captain",
      captainPin: "12ab"
    });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /captainPin must be exactly 6 digits/i);
});

test("resetting to a seed variant preserves assigned participants", async () => {
  const { seed, http } = await setup();
  const adminToken = await loginAsAdmin(http);
  const team = seed.teams[0];

  const assignResponse = await http
    .post("/api/admin/team-assignments/assign")
    .set("x-admin-token", adminToken)
    .send({ teamId: team.name.toLowerCase(), participantName: "Carry Over Player" });
  assert.equal(assignResponse.status, 200);

  const resetResponse = await http
    .post("/api/admin/reset-seed")
    .set("x-admin-token", adminToken)
    .send({ variant: "test" });
  assert.equal(resetResponse.status, 200);
  assert.equal(resetResponse.body.variant, "test");
  assert.equal(resetResponse.body.requiresRestart, true);

  const rosterResponse = await http
    .get("/api/admin/team-assignments")
    .set("x-admin-token", adminToken);
  assert.equal(rosterResponse.status, 200);

  const roster = rosterResponse.body.teams.find((entry: { teamId: string }) => entry.teamId === team.name.toLowerCase());
  assert.ok(roster);
  assert.ok(roster.assignedParticipants.includes("Carry Over Player"));

  const joinResponse = await http.post("/api/auth/join").send({
    joinCode: team.join_code,
    displayName: "Carry Over Player"
  });
  assert.equal(joinResponse.status, 200);
});

test("join endpoint enforces rate limits", async () => {
  const { seed, http } = await setupWithRateLimits({
    joinWindowMs: 60_000,
    joinMax: 2,
    adminLoginWindowMs: 60_000,
    adminLoginMax: 10,
    scanValidateWindowMs: 60_000,
    scanValidateMax: 20,
    submitWindowMs: 60_000,
    submitMax: 20,
    sabotageTriggerWindowMs: 60_000,
    sabotageTriggerMax: 20
  });
  const team = seed.teams[0];

  await assignParticipant(http, team.join_code, "Rate Limit Member 1");
  await assignParticipant(http, team.join_code, "Rate Limit Member 2");
  await assignParticipant(http, team.join_code, "Rate Limit Member 3");

  const firstJoin = await http.post("/api/auth/join").send({
    joinCode: team.join_code,
    displayName: "Rate Limit Member 1"
  });
  assert.equal(firstJoin.status, 200);

  const secondJoin = await http.post("/api/auth/join").send({
    joinCode: team.join_code,
    displayName: "Rate Limit Member 2"
  });
  assert.equal(secondJoin.status, 200);

  const thirdJoin = await http.post("/api/auth/join").send({
    joinCode: team.join_code,
    displayName: "Rate Limit Member 3"
  });
  assert.equal(thirdJoin.status, 429);
  assert.match(thirdJoin.body.error, /too many join attempts/i);
});

test("admin login endpoint enforces rate limits", async () => {
  const { http } = await setupWithRateLimits({
    joinWindowMs: 60_000,
    joinMax: 10,
    adminLoginWindowMs: 60_000,
    adminLoginMax: 2,
    scanValidateWindowMs: 60_000,
    scanValidateMax: 20,
    submitWindowMs: 60_000,
    submitMax: 20,
    sabotageTriggerWindowMs: 60_000,
    sabotageTriggerMax: 20
  });

  const firstLogin = await http.post("/api/auth/admin/login").send({ password: "changeme" });
  assert.equal(firstLogin.status, 200);

  const secondLogin = await http.post("/api/auth/admin/login").send({ password: "changeme" });
  assert.equal(secondLogin.status, 200);

  const thirdLogin = await http.post("/api/auth/admin/login").send({ password: "changeme" });
  assert.equal(thirdLogin.status, 429);
  assert.match(thirdLogin.body.error, /too many admin login attempts/i);
});

test("scan validate endpoint enforces rate limits", async () => {
  const { seed, http } = await setupWithRateLimits({
    joinWindowMs: 60_000,
    joinMax: 10,
    adminLoginWindowMs: 60_000,
    adminLoginMax: 10,
    scanValidateWindowMs: 60_000,
    scanValidateMax: 2,
    submitWindowMs: 60_000,
    submitMax: 20,
    sabotageTriggerWindowMs: 60_000,
    sabotageTriggerMax: 20
  });
  const team = seed.teams[0];
  const captainToken = await joinAsCaptain(http, team.join_code, team.captain_pin);

  const sessionOne = await http
    .post("/api/team/me/scan-session")
    .set("x-auth-token", captainToken)
    .send({});
  assert.equal(sessionOne.status, 200);

  const sessionTwo = await http
    .post("/api/team/me/scan-session")
    .set("x-auth-token", captainToken)
    .send({});
  assert.equal(sessionTwo.status, 200);

  const firstValidate = await http
    .post("/api/team/me/scan-validate")
    .set("x-auth-token", captainToken)
    .send({ scanSessionToken: sessionOne.body.scanSessionToken, checkpointPublicId: "WRONG-CHECKPOINT" });
  assert.equal(firstValidate.status, 400);

  const secondValidate = await http
    .post("/api/team/me/scan-validate")
    .set("x-auth-token", captainToken)
    .send({ scanSessionToken: sessionTwo.body.scanSessionToken, checkpointPublicId: "WRONG-CHECKPOINT" });
  assert.equal(secondValidate.status, 400);

  const blockedValidate = await http
    .post("/api/team/me/scan-validate")
    .set("x-auth-token", captainToken)
    .send({ scanSessionToken: sessionTwo.body.scanSessionToken, checkpointPublicId: "WRONG-CHECKPOINT" });
  assert.equal(blockedValidate.status, 429);
  assert.match(blockedValidate.body.error, /too many scan validations/i);
});

test("submit endpoint enforces rate limits", async () => {
  const { seed, http } = await setupWithRateLimits({
    joinWindowMs: 60_000,
    joinMax: 10,
    adminLoginWindowMs: 60_000,
    adminLoginMax: 10,
    scanValidateWindowMs: 60_000,
    scanValidateMax: 20,
    submitWindowMs: 60_000,
    submitMax: 1,
    sabotageTriggerWindowMs: 60_000,
    sabotageTriggerMax: 20
  });
  const team = seed.teams[0];
  const captainToken = await joinAsCaptain(http, team.join_code, team.captain_pin);

  await ensureScanIfRequired(http, captainToken);

  const firstSubmit = await http
    .post("/api/team/me/submit")
    .set("x-auth-token", captainToken)
    .send({ textContent: "rate limit attempt one" });
  assert.equal(firstSubmit.status, 200);

  const secondSubmit = await http
    .post("/api/team/me/submit")
    .set("x-auth-token", captainToken)
    .send({ textContent: "rate limit attempt two" });
  assert.equal(secondSubmit.status, 429);
  assert.match(secondSubmit.body.error, /too many submissions/i);

  const blockedSubmit = await http
    .post("/api/team/me/submit")
    .set("x-auth-token", captainToken)
    .send({ textContent: "rate limit attempt three" });
  assert.equal(blockedSubmit.status, 429);
  assert.match(blockedSubmit.body.error, /too many submissions/i);
});

test("sabotage trigger endpoint enforces rate limits", async () => {
  const { seed, http } = await setupWithRateLimits({
    joinWindowMs: 60_000,
    joinMax: 10,
    adminLoginWindowMs: 60_000,
    adminLoginMax: 10,
    scanValidateWindowMs: 60_000,
    scanValidateMax: 20,
    submitWindowMs: 60_000,
    submitMax: 20,
    sabotageTriggerWindowMs: 60_000,
    sabotageTriggerMax: 1
  });
  const team = seed.teams[0];
  const captainToken = await joinAsCaptain(http, team.join_code, team.captain_pin);

  const catalogResponse = await http.get("/api/sabotage/catalog");
  assert.equal(catalogResponse.status, 200);
  const actionId = catalogResponse.body.items[0]?.id as string | undefined;
  assert.ok(actionId);

  const triggerBody = { actionId };

  const firstTrigger = await http
    .post("/api/team/me/sabotage/trigger")
    .set("x-auth-token", captainToken)
    .send(triggerBody);
  assert.equal(firstTrigger.status, 200);

  const secondTrigger = await http
    .post("/api/team/me/sabotage/trigger")
    .set("x-auth-token", captainToken)
    .send(triggerBody);
  assert.equal(secondTrigger.status, 429);
  assert.match(secondTrigger.body.error, /too many sabotage attempts/i);

  const blockedTrigger = await http
    .post("/api/team/me/sabotage/trigger")
    .set("x-auth-token", captainToken)
    .send(triggerBody);
  assert.equal(blockedTrigger.status, 429);
  assert.match(blockedTrigger.body.error, /too many sabotage attempts/i);
});

test("captain cannot pass a required clue", async () => {
  const { seed, http } = await setup();
  const team = seed.teams[0];
  const requiredClueIndex = seed.clues
    .sort((a, b) => a.order_index - b.order_index)
    .findIndex((clue) => clue.required_flag);

  assert.ok(requiredClueIndex >= 0);

  const captainToken = await joinAsCaptain(http, team.join_code, team.captain_pin);
  const adminToken = await loginAsAdmin(http);

  const reopenResponse = await http
    .post(`/api/admin/team/${team.name.toLowerCase()}/reopen-clue`)
    .set("x-admin-token", adminToken)
    .send({ clueIndex: requiredClueIndex, reason: "Test required pass rule" });

  assert.equal(reopenResponse.status, 200);

  const passResponse = await http
    .post("/api/team/me/pass")
    .set("x-auth-token", captainToken)
    .send({});

  assert.equal(passResponse.status, 400);
  assert.match(passResponse.body.error, /required clues cannot be passed/i);
});

test("scan validation rejects QR for a future clue", async () => {
  const { seed, http } = await setup();
  const team = seed.teams[0];
  const captainToken = await joinAsCaptain(http, team.join_code, team.captain_pin);

  const scanSessionResponse = await http
    .post("/api/team/me/scan-session")
    .set("x-auth-token", captainToken)
    .send({});

  assert.equal(scanSessionResponse.status, 200);

  const sortedClues = [...seed.clues].sort((a, b) => a.order_index - b.order_index);
  const futureCheckpoint = sortedClues[1]?.qr_public_id ?? "future-checkpoint";

  const validateResponse = await http
    .post("/api/team/me/scan-validate")
    .set("x-auth-token", captainToken)
    .send({
      scanSessionToken: scanSessionResponse.body.scanSessionToken,
      checkpointPublicId: futureCheckpoint
    });

  assert.equal(validateResponse.status, 400);
  assert.match(validateResponse.body.error, /does not match current clue/i);
});

test("needs-review submission appears in queue and can be resolved", async () => {
  const { seed, http } = await setup();
  const team = seed.teams[0];
  const captainToken = await joinAsCaptain(http, team.join_code, team.captain_pin);
  const adminToken = await loginAsAdmin(http);

  await ensureScanIfRequired(http, captainToken);

  const submitResponse = await http
    .post("/api/team/me/submit")
    .set("x-auth-token", captainToken)
    .send({ textContent: "please review this submission" });

  assert.equal(submitResponse.status, 200);
  assert.equal(submitResponse.body.verdict, "NEEDS_REVIEW");

  const queueResponse = await http
    .get("/api/admin/review-queue")
    .set("x-admin-token", adminToken);

  assert.equal(queueResponse.status, 200);
  assert.ok(Array.isArray(queueResponse.body.items));
  assert.equal(queueResponse.body.items.length, 1);

  const reviewId = queueResponse.body.items[0].id as string;
  const resolveResponse = await http
    .post(`/api/admin/review/${reviewId}/resolve`)
    .set("x-admin-token", adminToken)
    .send({ verdict: "PASS" });

  assert.equal(resolveResponse.status, 200);
  assert.equal(resolveResponse.body.verdict, "PASS");

  const leaderboardResponse = await http.get("/api/leaderboard");
  assert.equal(leaderboardResponse.status, 200);
  const testedTeam = leaderboardResponse.body.teams.find((entry: { teamId: string }) => entry.teamId === team.name.toLowerCase());
  assert.ok(testedTeam);
  assert.ok(testedTeam.scoreTotal > 0);
});

test("sabotage cooldown is enforced per action", async () => {
  const { seed, http } = await setup();
  const team = seed.teams[0];
  const captainToken = await joinAsCaptain(http, team.join_code, team.captain_pin);

  const catalogResponse = await http.get("/api/sabotage/catalog");
  assert.equal(catalogResponse.status, 200);
  const actionId = catalogResponse.body.items[0]?.id as string | undefined;
  assert.ok(actionId);

  const firstTrigger = await http
    .post("/api/team/me/sabotage/trigger")
    .set("x-auth-token", captainToken)
    .send({ actionId });

  assert.equal(firstTrigger.status, 200);

  const secondTrigger = await http
    .post("/api/team/me/sabotage/trigger")
    .set("x-auth-token", captainToken)
    .send({ actionId });

  assert.equal(secondTrigger.status, 400);
  assert.match(secondTrigger.body.error, /cooldown/i);
});

test("admin deduction updates leaderboard and writes audit log", async () => {
  const { seed, http } = await setup();
  const team = seed.teams[0];
  const teamId = team.name.toLowerCase();
  const captainToken = await joinAsCaptain(http, team.join_code, team.captain_pin);
  const adminToken = await loginAsAdmin(http);

  await ensureScanIfRequired(http, captainToken);

  const submitResponse = await http
    .post("/api/team/me/submit")
    .set("x-auth-token", captainToken)
    .send({ textContent: "valid proof for score" });
  assert.equal(submitResponse.status, 200);
  assert.equal(submitResponse.body.verdict, "PASS");

  const beforeLeaderboard = await http.get("/api/leaderboard");
  assert.equal(beforeLeaderboard.status, 200);
  const beforeScore = (beforeLeaderboard.body.teams.find((entry: { teamId: string; scoreTotal: number }) => entry.teamId === teamId)?.scoreTotal ?? 0) as number;
  assert.ok(beforeScore > 0);

  const deductResponse = await http
    .post(`/api/admin/team/${teamId}/deduct`)
    .set("x-admin-token", adminToken)
    .send({ amount: 10, reason: "Screenshot penalty" });
  assert.equal(deductResponse.status, 200);
  assert.equal(deductResponse.body.amount, 10);

  const afterLeaderboard = await http.get("/api/leaderboard");
  assert.equal(afterLeaderboard.status, 200);
  const afterScore = (afterLeaderboard.body.teams.find((entry: { teamId: string; scoreTotal: number }) => entry.teamId === teamId)?.scoreTotal ?? 0) as number;
  assert.equal(afterScore, beforeScore - 10);

  const auditLogs = await http
    .get("/api/admin/audit-logs")
    .set("x-admin-token", adminToken);
  assert.equal(auditLogs.status, 200);

  const deductionLog = auditLogs.body.items.find((item: { action: string; targetId: string; reason?: string }) => item.action === "POINTS_DEDUCTED" && item.targetId === teamId);
  assert.ok(deductionLog);
  assert.equal(deductionLog.reason, "Screenshot penalty");
});

test("submit pass emits realtime clue and leaderboard events", async () => {
  const { seed, http, emissions } = await setup();
  const team = seed.teams[0];
  const teamId = team.name.toLowerCase();
  const captainToken = await joinAsCaptain(http, team.join_code, team.captain_pin);

  await ensureScanIfRequired(http, captainToken);

  const submitResponse = await http
    .post("/api/team/me/submit")
    .set("x-auth-token", captainToken)
    .send({ textContent: "valid proof for realtime" });
  assert.equal(submitResponse.status, 200);
  assert.equal(submitResponse.body.verdict, "PASS");

  const roomAdvance = emissions.find((entry) => entry.scope === "room" && entry.room === teamId && entry.event === "team:clue_advanced");
  assert.ok(roomAdvance);

  const roomVerdict = emissions.find((entry) => entry.scope === "room" && entry.room === teamId && entry.event === "submission:verdict_ready");
  assert.ok(roomVerdict);

  const leaderboardUpdate = emissions.find((entry) => entry.scope === "all" && entry.event === "leaderboard:updated");
  assert.ok(leaderboardUpdate);
});

test("admin clue reopen emits team-scoped realtime event", async () => {
  const { seed, http, emissions } = await setup();
  const team = seed.teams[0];
  const teamId = team.name.toLowerCase();
  const adminToken = await loginAsAdmin(http);

  const response = await http
    .post(`/api/admin/team/${teamId}/reopen-clue`)
    .set("x-admin-token", adminToken)
    .send({ clueIndex: 0, reason: "Manual review window", durationSeconds: 120 });

  assert.equal(response.status, 200);

  const reopenEvent = emissions.find((entry) => entry.scope === "room" && entry.room === teamId && entry.event === "admin:clue_reopened");
  assert.ok(reopenEvent);
});

test("sabotage trigger emits global realtime event", async () => {
  const { seed, http, emissions } = await setup();
  const team = seed.teams[0];
  const captainToken = await joinAsCaptain(http, team.join_code, team.captain_pin);

  const catalogResponse = await http.get("/api/sabotage/catalog");
  assert.equal(catalogResponse.status, 200);
  const actionId = catalogResponse.body.items[0]?.id as string | undefined;
  assert.ok(actionId);

  const triggerResponse = await http
    .post("/api/team/me/sabotage/trigger")
    .set("x-auth-token", captainToken)
    .send({ actionId });

  assert.equal(triggerResponse.status, 200);

  const sabotageEvent = emissions.find((entry) => entry.scope === "all" && entry.event === "sabotage:triggered");
  assert.ok(sabotageEvent);
});

test("admin game status change emits global realtime event", async () => {
  const { http, emissions } = await setup();
  const adminToken = await loginAsAdmin(http);

  const response = await http
    .post("/api/game/status")
    .set("x-admin-token", adminToken)
    .send({ status: "RUNNING" });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "RUNNING");

  const statusEvent = emissions.find((entry) => entry.scope === "all" && entry.event === "game:status_changed");
  assert.ok(statusEvent);
});

test("team event feed returns recent security and sabotage entries", async () => {
  const { seed, http } = await setup();
  const team = seed.teams[0];
  const captainToken = await joinAsCaptain(http, team.join_code, team.captain_pin);

  const catalogResponse = await http.get("/api/sabotage/catalog");
  assert.equal(catalogResponse.status, 200);
  const actionId = catalogResponse.body.items[0]?.id as string | undefined;
  assert.ok(actionId);

  const sabotageResponse = await http
    .post("/api/team/me/sabotage/trigger")
    .set("x-auth-token", captainToken)
    .send({ actionId });
  assert.equal(sabotageResponse.status, 200);

  const securityResponse = await http
    .post("/api/team/me/security-events")
    .set("x-auth-token", captainToken)
    .send({ type: "SCREENSHOT_ATTEMPT", clueIndex: 0, deviceInfo: "ios-test" });
  assert.equal(securityResponse.status, 200);

  const feedResponse = await http
    .get("/api/team/me/event-feed")
    .set("x-auth-token", captainToken);
  assert.equal(feedResponse.status, 200);
  assert.ok(Array.isArray(feedResponse.body.items));

  const hasSecurity = feedResponse.body.items.some((entry: { type: string }) => entry.type === "SECURITY");
  const hasSabotage = feedResponse.body.items.some((entry: { type: string }) => entry.type === "SABOTAGE");
  assert.equal(hasSecurity, true);
  assert.equal(hasSabotage, true);
});

test("team submissions endpoint returns recent verdict history", async () => {
  const { seed, http } = await setup();
  const team = seed.teams[0];
  const captainToken = await joinAsCaptain(http, team.join_code, team.captain_pin);

  await ensureScanIfRequired(http, captainToken);

  const submitResponse = await http
    .post("/api/team/me/submit")
    .set("x-auth-token", captainToken)
    .send({ textContent: "history proof" });
  assert.equal(submitResponse.status, 200);

  const historyResponse = await http
    .get("/api/team/me/submissions")
    .set("x-auth-token", captainToken);

  assert.equal(historyResponse.status, 200);
  assert.ok(Array.isArray(historyResponse.body.items));
  assert.ok(historyResponse.body.items.length >= 1);
  assert.equal(typeof historyResponse.body.items[0].verdict, "string");
  assert.ok(Array.isArray(historyResponse.body.items[0].reasons));
});

test("admin can invalidate scan sessions for a team", async () => {
  const { seed, http } = await setup();
  const team = seed.teams[0];
  const captainToken = await joinAsCaptain(http, team.join_code, team.captain_pin);
  const adminToken = await loginAsAdmin(http);

  const scanSessionResponse = await http
    .post("/api/team/me/scan-session")
    .set("x-auth-token", captainToken)
    .send({});
  assert.equal(scanSessionResponse.status, 200);

  const invalidateResponse = await http
    .post("/api/admin/scan-sessions/invalidate")
    .set("x-admin-token", adminToken)
    .send({ teamId: team.name.toLowerCase() });
  assert.equal(invalidateResponse.status, 200);
  assert.ok(invalidateResponse.body.invalidatedCount >= 1);

  const stateResponse = await http
    .get("/api/team/me/state")
    .set("x-auth-token", captainToken);
  assert.equal(stateResponse.status, 200);

  const validateResponse = await http
    .post("/api/team/me/scan-validate")
    .set("x-auth-token", captainToken)
    .send({
      scanSessionToken: scanSessionResponse.body.scanSessionToken,
      checkpointPublicId: stateResponse.body.currentClue.qr_public_id
    });
  assert.equal(validateResponse.status, 400);
  assert.match(validateResponse.body.error, /already used/i);
});

test("admin can rotate clue qr id and old qr is rejected", async () => {
  const { seed, http, emissions } = await setup();
  const team = seed.teams[0];
  const captainToken = await joinAsCaptain(http, team.join_code, team.captain_pin);
  const adminToken = await loginAsAdmin(http);

  const stateResponse = await http
    .get("/api/team/me/state")
    .set("x-auth-token", captainToken);
  assert.equal(stateResponse.status, 200);
  const clueIndex = stateResponse.body.currentClueIndex as number;
  const oldQr = stateResponse.body.currentClue.qr_public_id as string;

  const rotateResponse = await http
    .post(`/api/admin/clues/${clueIndex}/rotate-qr`)
    .set("x-admin-token", adminToken)
    .send({});
  assert.equal(rotateResponse.status, 200);
  assert.notEqual(rotateResponse.body.qrPublicId, oldQr);

  const rotatedEvent = emissions.find((entry) => entry.scope === "all" && entry.event === "admin:qr_rotated");
  assert.ok(rotatedEvent);

  const sessionResponse = await http
    .post("/api/team/me/scan-session")
    .set("x-auth-token", captainToken)
    .send({});
  assert.equal(sessionResponse.status, 200);

  const oldQrValidate = await http
    .post("/api/team/me/scan-validate")
    .set("x-auth-token", captainToken)
    .send({
      scanSessionToken: sessionResponse.body.scanSessionToken,
      checkpointPublicId: oldQr
    });
  assert.equal(oldQrValidate.status, 400);

  const sessionResponse2 = await http
    .post("/api/team/me/scan-session")
    .set("x-auth-token", captainToken)
    .send({});
  assert.equal(sessionResponse2.status, 200);

  const newQrValidate = await http
    .post("/api/team/me/scan-validate")
    .set("x-auth-token", captainToken)
    .send({
      scanSessionToken: sessionResponse2.body.scanSessionToken,
      checkpointPublicId: rotateResponse.body.qrPublicId
    });
  assert.equal(newQrValidate.status, 200);
});

test("admin clues endpoint supports source query", async () => {
  const { http } = await setup();
  const adminToken = await loginAsAdmin(http);

  const response = await http
    .get("/api/admin/clues?source=production")
    .set("x-admin-token", adminToken);

  assert.equal(response.status, 200);
  assert.equal(response.body.requestedSource, "production");
  assert.ok(Array.isArray(response.body.clues));
  assert.ok(response.body.clues.length > 0);
  assert.ok(response.body.resolvedSource === "production" || response.body.resolvedSource === "default");
  assert.equal(typeof response.body.fallbackToDefault, "boolean");
});

test("admin clues endpoint rejects invalid source query", async () => {
  const { http } = await setup();
  const adminToken = await loginAsAdmin(http);

  const response = await http
    .get("/api/admin/clues?source=staging")
    .set("x-admin-token", adminToken);

  assert.equal(response.status, 400);
  assert.match(response.body.error, /source must be/i);
});

test("admin can upload test clue file and fetch it via source query", async () => {
  const { seed, http } = await setup();
  const adminToken = await loginAsAdmin(http);

  const uploadedTitle = "Uploaded Test Clue";
  const uploadPayload = {
    ...seed,
    clues: seed.clues.map((clue, index) =>
      index === 0
        ? { ...clue, title: uploadedTitle }
        : clue
    )
  };

  let uploadedPath = "";
  const expectedUploadPath = resolveVariantPathForTests("seed-config.test.json");
  const originalUploadContent = fs.existsSync(expectedUploadPath)
    ? fs.readFileSync(expectedUploadPath, "utf-8")
    : null;

  try {
    const uploadResponse = await http
      .post("/api/admin/clues/upload")
      .set("x-admin-token", adminToken)
      .send({ source: "test", seedConfig: uploadPayload });

    assert.equal(uploadResponse.status, 200);
    assert.equal(uploadResponse.body.source, "test");
    assert.equal(uploadResponse.body.clueCount, seed.clues.length);
    assert.equal(typeof uploadResponse.body.sourceFile, "string");

    uploadedPath = uploadResponse.body.sourceFile as string;
    assert.equal(fs.existsSync(uploadedPath), true);

    const cluesResponse = await http
      .get("/api/admin/clues?source=test")
      .set("x-admin-token", adminToken);

    assert.equal(cluesResponse.status, 200);
    assert.equal(cluesResponse.body.requestedSource, "test");
    assert.equal(cluesResponse.body.resolvedSource, "test");
    assert.equal(cluesResponse.body.fallbackToDefault, false);
    assert.equal(cluesResponse.body.clues[0]?.title, uploadedTitle);
  } finally {
    if (originalUploadContent !== null) {
      fs.writeFileSync(expectedUploadPath, originalUploadContent, "utf-8");
    } else if (uploadedPath) {
      fs.rmSync(uploadedPath, { force: true });
    }
  }
});

test("admin can upload schema v2 clue dataset and fetch converted clues", async () => {
  const { http } = await setup();
  const adminToken = await loginAsAdmin(http);

  const uploadPayload = {
    schema_version: "2.0.0",
    dataset_type: "scavenger_hunt",
    environment: "test",
    dataset_id: "adapter-upload-test",
    metadata: {
      name: "Adapter Upload Test",
      timezone: "America/Los_Angeles"
    },
    scoring: {
      default_points: 1,
      special_points: {
        "adapter-upload-2": 3
      }
    },
    zones: [
      { zone_id: "z1", name: "Zone 1", route_order: 1, transport_mode: "walk" },
      { zone_id: "z2", name: "Zone 2", route_order: 2, transport_mode: "waymo" }
    ],
    clues: [
      { id: "adapter-upload-1", route_order: 1, zone_id: "z1", title: "Converted One", theme: "Theme One", difficulty: "easy" },
      { id: "adapter-upload-2", route_order: 2, zone_id: "z2", title: "Converted Two", theme: "Theme Two", difficulty: "medium" }
    ]
  };

  let uploadedPath = "";
  const expectedUploadPath = resolveVariantPathForTests("seed-config.test.json");
  const originalUploadContent = fs.existsSync(expectedUploadPath)
    ? fs.readFileSync(expectedUploadPath, "utf-8")
    : null;

  try {
    const uploadResponse = await http
      .post("/api/admin/clues/upload")
      .set("x-admin-token", adminToken)
      .send({ source: "test", seedConfig: uploadPayload });

    assert.equal(uploadResponse.status, 200);
    assert.equal(uploadResponse.body.source, "test");
    assert.equal(uploadResponse.body.clueCount, 2);
    uploadedPath = uploadResponse.body.sourceFile as string;

    const cluesResponse = await http
      .get("/api/admin/clues?source=test")
      .set("x-admin-token", adminToken);

    assert.equal(cluesResponse.status, 200);
    assert.equal(cluesResponse.body.requestedSource, "test");
    assert.equal(cluesResponse.body.clues[0]?.title, "Converted One");
    assert.equal(cluesResponse.body.clues[0]?.requires_scan, false);
    assert.equal(cluesResponse.body.clues[1]?.base_points, 300);
  } finally {
    if (originalUploadContent !== null) {
      fs.writeFileSync(expectedUploadPath, originalUploadContent, "utf-8");
    } else if (uploadedPath) {
      fs.rmSync(uploadedPath, { force: true });
    }
  }
});

test("admin clue upload rejects invalid payload", async () => {
  const { http } = await setup();
  const adminToken = await loginAsAdmin(http);

  const response = await http
    .post("/api/admin/clues/upload")
    .set("x-admin-token", adminToken)
    .send({ source: "test", seedConfig: { clues: [] } });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /invalid seed upload payload|unsupported seed config format/i);
});

test("admin clue template endpoint returns seed config", async () => {
  const { http } = await setup();
  const adminToken = await loginAsAdmin(http);

  const response = await http
    .get("/api/admin/clues/template?source=production")
    .set("x-admin-token", adminToken);

  assert.equal(response.status, 200);
  assert.equal(response.body.requestedSource, "production");
  assert.equal(typeof response.body.fallbackToDefault, "boolean");
  assert.equal(typeof response.body.sourceFile, "string");
  assert.ok(Array.isArray(response.body.seedConfig?.clues));
  assert.ok(response.body.seedConfig.clues.length > 0);
});

test("admin clue template endpoint rejects invalid source", async () => {
  const { http } = await setup();
  const adminToken = await loginAsAdmin(http);

  const response = await http
    .get("/api/admin/clues/template?source=preview")
    .set("x-admin-token", adminToken);

  assert.equal(response.status, 400);
  assert.match(response.body.error, /source must be/i);
});

test("admin security and audit endpoints respect limit query", async () => {
  const { seed, http } = await setup();
  const team = seed.teams[0];
  const captainToken = await joinAsCaptain(http, team.join_code, team.captain_pin);
  const adminToken = await loginAsAdmin(http);

  const securityOne = await http
    .post("/api/team/me/security-events")
    .set("x-auth-token", captainToken)
    .send({ type: "SCREENSHOT_ATTEMPT", clueIndex: 0, deviceInfo: "ios-a" });
  assert.equal(securityOne.status, 200);

  const securityTwo = await http
    .post("/api/team/me/security-events")
    .set("x-auth-token", captainToken)
    .send({ type: "OTHER", clueIndex: 0, deviceInfo: "ios-b" });
  assert.equal(securityTwo.status, 200);

  const securityList = await http
    .get("/api/admin/security-events?limit=1")
    .set("x-admin-token", adminToken);
  assert.equal(securityList.status, 200);
  assert.equal(securityList.body.items.length, 1);
  assert.ok(securityList.body.total >= 2);
  assert.equal(securityList.body.limit, 1);
  assert.equal(securityList.body.offset, 0);

  const securityOffset = await http
    .get("/api/admin/security-events?limit=1&offset=1")
    .set("x-admin-token", adminToken);
  assert.equal(securityOffset.status, 200);
  assert.equal(securityOffset.body.items.length, 1);
  assert.ok(securityOffset.body.total >= 2);
  assert.equal(securityOffset.body.limit, 1);
  assert.equal(securityOffset.body.offset, 1);
  assert.notEqual(securityOffset.body.items[0].id, securityList.body.items[0].id);

  const deduct = await http
    .post(`/api/admin/team/${team.name.toLowerCase()}/deduct`)
    .set("x-admin-token", adminToken)
    .send({ amount: 5, reason: "limit-check" });
  assert.equal(deduct.status, 200);

  const auditList = await http
    .get("/api/admin/audit-logs?limit=1")
    .set("x-admin-token", adminToken);
  assert.equal(auditList.status, 200);
  assert.equal(auditList.body.items.length, 1);
  assert.ok(auditList.body.total >= 1);
  assert.equal(auditList.body.limit, 1);
  assert.equal(auditList.body.offset, 0);

  const auditOffset = await http
    .get("/api/admin/audit-logs?limit=1&offset=1")
    .set("x-admin-token", adminToken);
  assert.equal(auditOffset.status, 200);
  assert.equal(auditOffset.body.items.length, 1);
  assert.ok(auditOffset.body.total >= 2);
  assert.equal(auditOffset.body.limit, 1);
  assert.equal(auditOffset.body.offset, 1);
  assert.notEqual(auditOffset.body.items[0].id, auditList.body.items[0].id);
});

test("admin review queue endpoint respects limit query", async () => {
  const { seed, http } = await setup();
  const team = seed.teams[0];
  const captainToken = await joinAsCaptain(http, team.join_code, team.captain_pin);
  const adminToken = await loginAsAdmin(http);

  await ensureScanIfRequired(http, captainToken);

  const reviewOne = await http
    .post("/api/team/me/submit")
    .set("x-auth-token", captainToken)
    .send({ textContent: "review first item" });
  assert.equal(reviewOne.status, 200);
  assert.equal(reviewOne.body.verdict, "NEEDS_REVIEW");

  const reviewTwo = await http
    .post("/api/team/me/submit")
    .set("x-auth-token", captainToken)
    .send({ textContent: "review second item" });
  assert.equal(reviewTwo.status, 200);
  assert.equal(reviewTwo.body.verdict, "NEEDS_REVIEW");

  const queueLimited = await http
    .get("/api/admin/review-queue?limit=1")
    .set("x-admin-token", adminToken);
  assert.equal(queueLimited.status, 200);
  assert.equal(queueLimited.body.items.length, 1);
  assert.equal(queueLimited.body.total, 2);
  assert.equal(queueLimited.body.limit, 1);
  assert.equal(queueLimited.body.offset, 0);

  const queueOffset = await http
    .get("/api/admin/review-queue?limit=1&offset=1")
    .set("x-admin-token", adminToken);
  assert.equal(queueOffset.status, 200);
  assert.equal(queueOffset.body.items.length, 1);
  assert.equal(queueOffset.body.total, 2);
  assert.equal(queueOffset.body.limit, 1);
  assert.equal(queueOffset.body.offset, 1);
  assert.notEqual(queueOffset.body.items[0].id, queueLimited.body.items[0].id);
});

test("team event feed endpoint respects limit query", async () => {
  const { seed, http } = await setup();
  const team = seed.teams[0];
  const captainToken = await joinAsCaptain(http, team.join_code, team.captain_pin);

  const securityOne = await http
    .post("/api/team/me/security-events")
    .set("x-auth-token", captainToken)
    .send({ type: "SCREENSHOT_ATTEMPT", clueIndex: 0, deviceInfo: "ios-a" });
  assert.equal(securityOne.status, 200);

  const securityTwo = await http
    .post("/api/team/me/security-events")
    .set("x-auth-token", captainToken)
    .send({ type: "OTHER", clueIndex: 0, deviceInfo: "ios-b" });
  assert.equal(securityTwo.status, 200);

  const feedLimited = await http
    .get("/api/team/me/event-feed?limit=1")
    .set("x-auth-token", captainToken);
  assert.equal(feedLimited.status, 200);
  assert.equal(feedLimited.body.items.length, 1);
  assert.ok(feedLimited.body.total >= 2);
  assert.equal(feedLimited.body.limit, 1);
  assert.equal(feedLimited.body.offset, 0);

  const feedOffset = await http
    .get("/api/team/me/event-feed?limit=1&offset=1")
    .set("x-auth-token", captainToken);
  assert.equal(feedOffset.status, 200);
  assert.equal(feedOffset.body.items.length, 1);
  assert.ok(feedOffset.body.total >= 2);
  assert.equal(feedOffset.body.limit, 1);
  assert.equal(feedOffset.body.offset, 1);
  assert.notEqual(feedOffset.body.items[0].id, feedLimited.body.items[0].id);
});

test("team submissions endpoint respects limit query", async () => {
  const { seed, http } = await setup();
  const team = seed.teams[0];
  const captainToken = await joinAsCaptain(http, team.join_code, team.captain_pin);

  await ensureScanIfRequired(http, captainToken);

  const first = await http
    .post("/api/team/me/submit")
    .set("x-auth-token", captainToken)
    .send({ textContent: "history one" });
  assert.equal(first.status, 200);

  await ensureScanIfRequired(http, captainToken);

  const second = await http
    .post("/api/team/me/submit")
    .set("x-auth-token", captainToken)
    .send({ textContent: "history two" });
  assert.equal(second.status, 200);

  const submissionsLimited = await http
    .get("/api/team/me/submissions?limit=1")
    .set("x-auth-token", captainToken);
  assert.equal(submissionsLimited.status, 200);
  assert.equal(submissionsLimited.body.items.length, 1);
  assert.equal(submissionsLimited.body.total, 2);
  assert.equal(submissionsLimited.body.limit, 1);
  assert.equal(submissionsLimited.body.offset, 0);

  const submissionsOffset = await http
    .get("/api/team/me/submissions?limit=1&offset=1")
    .set("x-auth-token", captainToken);
  assert.equal(submissionsOffset.status, 200);
  assert.equal(submissionsOffset.body.items.length, 1);
  assert.equal(submissionsOffset.body.total, 2);
  assert.equal(submissionsOffset.body.limit, 1);
  assert.equal(submissionsOffset.body.offset, 1);
  assert.notEqual(submissionsOffset.body.items[0].id, submissionsLimited.body.items[0].id);
});
