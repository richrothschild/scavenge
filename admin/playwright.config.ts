import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isCI = Boolean(process.env.CI);
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(currentDir, "../backend");

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    trace: "on-first-retry"
  },
  webServer: process.env.E2E_SKIP_WEBSERVER
    ? undefined
    : [
        {
          command: "npm run dev",
          cwd: backendDir,
          url: "http://localhost:3001/api/health",
          timeout: 120_000,
          reuseExistingServer: !isCI,
          env: {
            ...process.env,
            ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD ?? "changeme",
            PORT: "3001"
          }
        },
        {
          command: "npm run dev",
          cwd: currentDir,
          url: "http://localhost:5173",
          timeout: 120_000,
          reuseExistingServer: !isCI,
          env: {
            ...process.env,
            VITE_API_BASE_URL: process.env.E2E_API_BASE_URL ?? "http://localhost:3001/api"
          }
        }
      ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
