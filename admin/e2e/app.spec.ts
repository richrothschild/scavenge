import { expect, test } from "@playwright/test";

const joinCode = process.env.E2E_JOIN_CODE ?? "SPADES-AJ29LN";
const captainPin = process.env.E2E_CAPTAIN_PIN ?? "910546";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "changeme";

const loginAsAdmin = async (page: import("@playwright/test").Page) => {
  await page.goto("/admin");
  await page.getByTestId("admin-password-input").fill(adminPassword);
  await page.getByTestId("admin-login-button").click();
  await expect(page.getByText("Admin Ops")).toBeVisible();
  await expect(page.locator("p.status")).not.toContainText("Admin login failed");
};

test("join flow advances to in-game screen", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("join-code-input").fill(joinCode);
  await page.getByTestId("display-name-input").fill("E2E Member");
  await page.getByTestId("captain-pin-input").fill(captainPin);
  await page.getByTestId("join-submit-btn").click();

  await expect(page.getByTestId("player-header")).toBeVisible();
  await expect(page.getByRole("button", { name: "🗺️ Clue" })).toBeVisible();
});

test("team quick-select chips populate join field", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("team-chip-hearts").click();
  await expect(page.getByTestId("join-code-input")).toHaveValue("HEARTS");

  await page.getByTestId("join-code-input").fill("DIAMONDS-4AFYXZ");
  await expect(page.getByTestId("join-code-input")).toHaveValue("DIAMONDS");
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
