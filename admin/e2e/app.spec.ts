import { expect, test } from "@playwright/test";

const captainPin = process.env.E2E_CAPTAIN_PIN ?? "910546";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "changeme";

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

  await page.getByTestId("captain-team-select").selectOption("clubs");
  await page.getByTestId("captain-name-input").fill("E2E Backup Captain");
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
