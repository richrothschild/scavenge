import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

const captainPin = process.env.E2E_CAPTAIN_PIN ?? "910546";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "changeme";
const apiBase = process.env.E2E_API_BASE_URL ?? "http://localhost:3001/api";

const idempotencyKey = (scope: string) => `${scope}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const loginAsAdminApi = async (request: APIRequestContext) => {
  const response = await request.post(`${apiBase}/auth/admin/login`, {
    data: { password: adminPassword }
  });

  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { token: string };
  expect(payload.token).toBeTruthy();
  return payload.token;
};

const setupCaptainOnOptionalClue = async (
  request: APIRequestContext,
  teamId: string,
  participantName: string
) => {
  const adminToken = await loginAsAdminApi(request);

  const statusResponse = await request.post(`${apiBase}/game/status`, {
    headers: {
      "x-admin-token": adminToken,
      "x-idempotency-key": idempotencyKey("e2e-game-status")
    },
    data: { status: "RUNNING" }
  });
  expect(statusResponse.ok()).toBeTruthy();

  const assignResponse = await request.post(`${apiBase}/admin/team-assignments/assign`, {
    headers: {
      "x-admin-token": adminToken,
      "x-idempotency-key": idempotencyKey("e2e-assign-player")
    },
    data: { teamId, participantName }
  });
  expect(assignResponse.ok()).toBeTruthy();

  const captainResponse = await request.post(`${apiBase}/admin/team-assignments/captain`, {
    headers: {
      "x-admin-token": adminToken,
      "x-idempotency-key": idempotencyKey("e2e-assign-captain")
    },
    data: {
      teamId,
      captainName: participantName,
      captainPin,
      forceOverride: true
    }
  });
  expect(captainResponse.ok()).toBeTruthy();

  const cluesResponse = await request.get(`${apiBase}/admin/clues`, {
    headers: { "x-admin-token": adminToken }
  });
  expect(cluesResponse.ok()).toBeTruthy();
  const cluesPayload = await cluesResponse.json() as {
    clues: Array<{ index: number; required_flag: boolean }>;
  };

  const optionalClue = cluesPayload.clues.find((clue) => !clue.required_flag);
  expect(optionalClue).toBeTruthy();

  const reopenResponse = await request.post(`${apiBase}/admin/team/${teamId}/reopen-clue`, {
    headers: {
      "x-admin-token": adminToken,
      "x-idempotency-key": idempotencyKey("e2e-reopen-optional")
    },
    data: {
      clueIndex: optionalClue!.index,
      reason: "E2E skip clue validation"
    }
  });
  expect(reopenResponse.ok()).toBeTruthy();
};

const loginAsAdmin = async (page: import("@playwright/test").Page) => {
  await page.goto("/admin");
  await page.getByTestId("admin-password-input").fill(adminPassword);
  await page.getByTestId("admin-login-button").click();
  await expect(page.getByText("Admin Ops")).toBeVisible();
  await expect(page.locator("p.status")).not.toContainText("Admin login failed");
};

const assignParticipant = async (page: import("@playwright/test").Page, teamName: "SPADES" | "HEARTS" | "DIAMONDS" | "CLUBS", participantName: string) => {
  await page.goto("/admin");
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "Setup" }).click();
  await page.getByTestId("participant-team-select").selectOption(teamName.toLowerCase());
  await page.getByPlaceholder("Assign player name to selected team").fill(participantName);
  await page.getByTestId("assign-participant-button").click();
  await expect(page.getByRole("button", { name: participantName })).toBeVisible();
};

test("admin can update captain assignment and pin", async ({ page }) => {
  await page.goto("/admin");
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "Setup" }).click();

  await page.getByTestId("participant-team-select").selectOption("clubs");
  await page.getByPlaceholder("Assign player name to selected team").fill("E2E Backup Captain");
  await page.getByTestId("assign-participant-button").click();

  await page.getByTestId("captain-team-select").selectOption("clubs");
  await page.getByTestId("captain-name-input").selectOption("E2E Backup Captain");
  await page.getByTestId("captain-pin-admin-input").fill("123456");
  await page.getByTestId("assign-captain-button").click();

  await expect(page.getByText("Updated captain for clubs to E2E Backup Captain")).toBeVisible();

  await page.goto("/");
  await page.getByTestId("team-chip-clubs").click();
  await page.getByRole("button", { name: "E2E Backup Captain" }).click();
  await page.getByTestId("captain-pin-input").fill("123456");
  await page.getByTestId("join-submit-btn").click();
  await expect(page.getByTestId("player-header")).toBeVisible();
});

test("assigned player can join from the roster-based first page", async ({ page }) => {
  await assignParticipant(page, "SPADES", "E2E Captain");

  await page.goto("/");
  await page.getByTestId("team-chip-spades").click();
  await page.getByRole("button", { name: "E2E Captain" }).click();
  await page.getByTestId("captain-pin-input").fill(captainPin);
  await page.getByTestId("join-submit-btn").click();

  await expect(page.getByTestId("player-header")).toBeVisible();
  await expect(page.getByRole("button", { name: "🗺️ Clue" })).toBeVisible();
});

test("setup assignment appears on the first page roster and can be removed", async ({ page }) => {
  await assignParticipant(page, "HEARTS", "E2E Hearts Member");

  await page.goto("/admin");
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "Setup" }).click();
  await expect(page.locator(".assignment-card__meta", { hasText: "Captain PIN:" }).first()).toBeVisible();

  await page.goto("/");
  await page.getByTestId("team-chip-hearts").click();
  await expect(page.getByRole("button", { name: "E2E Hearts Member" })).toBeVisible();

  await page.goto("/admin");
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "Setup" }).click();
  await page.getByRole("button", { name: "E2E Hearts Member" }).click();

  await page.goto("/");
  await page.getByTestId("team-chip-hearts").click();
  await expect(page.getByRole("button", { name: "E2E Hearts Member" })).toHaveCount(0);
});

test("admin login works", async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page.getByText("Admin Ops")).toBeVisible();
});

test("admin can load review queue", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "Load Review Queue" }).click();

  await expect(page.getByRole("heading", { name: "Review Queue" })).toBeVisible();
});

test("admin can refresh leaderboard", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "Load Leaderboard" }).click();

  await expect(page.getByText("Leaderboard Snapshot")).toBeVisible();
  await expect(page.getByText("SPADES", { exact: false })).toBeVisible();
});

test("help screen dictator links open SMS composer", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Get Help" }).click();

  await page.getByTestId("help-issue-wrong_clue").click();

  const contactLink = page.getByTestId("contact-dictator-link");
  await expect(contactLink).toBeVisible();

  const contactHref = await contactLink.getAttribute("href");
  expect(contactHref).toContain("sms:4086054832");
  expect(contactHref).toContain("SCAVENGE%20HELP%20REQUEST");
  expect(contactHref).toContain("Issue%3A%20Wrong%20clue%20is%20showing");

  const testLink = page.getByTestId("contact-dictator-test-link");
  await expect(testLink).toBeVisible();

  const testHref = await testLink.getAttribute("href");
  expect(testHref).toContain("sms:4086054832");
  expect(testHref).toContain("SCAVENGE%20TEST");
  expect(testHref).toContain("Topic%3A%20Wrong%20clue%20is%20showing");
});

test("captain can skip an optional clue from the clue panel", async ({ page, request }) => {
  const participantName = `E2E Skip Captain ${Date.now()}`;
  const teamId = "spades";

  await setupCaptainOnOptionalClue(request, teamId, participantName);

  await page.goto("/");
  await page.getByTestId("team-chip-spades").click();
  await page.getByRole("button", { name: participantName }).click();
  await page.getByTestId("captain-pin-input").fill(captainPin);
  await page.getByTestId("join-submit-btn").click();

  await expect(page.getByTestId("player-header")).toBeVisible();

  const revealButton = page.getByRole("button", { name: /Reveal Clue/i });
  await expect(revealButton).toBeVisible();
  await revealButton.click();

  const readProgress = async () => {
    const rawText = (await page.locator(".progress-meta").textContent()) ?? "";
    const text = rawText.replace(/\u00a0/g, " ");
    const clueMatch = text.match(/Clue\s+(\d+)\s+of/i);
    const skippedMatch = text.match(/(\d+)\s+skipped/i);
    return {
      clue: clueMatch ? Number(clueMatch[1]) : NaN,
      skipped: skippedMatch ? Number(skippedMatch[1]) : NaN
    };
  };

  const before = await readProgress();
  expect(Number.isFinite(before.clue)).toBeTruthy();
  expect(Number.isFinite(before.skipped)).toBeTruthy();

  await page.getByRole("button", { name: "Skip this clue" }).click();

  await expect.poll(async () => {
    const current = await readProgress();
    return current.clue;
  }).toBe(before.clue + 1);

  await expect.poll(async () => {
    const current = await readProgress();
    return current.skipped;
  }).toBe(before.skipped + 1);

  const revealNextButton = page.getByRole("button", { name: /Reveal Clue/i });
  await expect(revealNextButton).toBeVisible();
  await revealNextButton.click();

  await expect(page.locator(".verdict-banner")).toHaveCount(0);
  await expect(page.getByText("Correct! Great work — moving to the next clue.")).toHaveCount(0);
});
