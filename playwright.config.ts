import { defineConfig, devices } from "@playwright/test";

// End-to-end tests. Needs postgres + redis running and migrations applied.
// CI runs against a production build; locally a dev server is started (or reused).
//
// With BASE_PATH set (e.g. /game-vote) only e2e/base-path.spec.ts runs, against
// a build served under that sub-path; the other specs assume the site root.
// Local runs read DATABASE_URL etc. from .env (tests seed data directly); in CI
// everything comes from the job environment. Existing variables win.
try {
  process.loadEnvFile(".env");
} catch {}

const basePath = process.env.BASE_PATH ?? "";

// Steam store and Web API requests go to a local mock (e2e/steam-mock.mjs).
const steamMockPort = 4100;
process.env.STEAM_STORE_URL ??= `http://localhost:${steamMockPort}`;
process.env.STEAM_API_URL ??= `http://localhost:${steamMockPort}`;

export default defineConfig({
  testDir: "e2e",
  ...(basePath ? { testMatch: "base-path.spec.ts" } : { testIgnore: "base-path.spec.ts" }),
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  // The dev server compiles routes on first hit, which is slow on small machines.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    locale: "zh-CN",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node e2e/steam-mock.mjs",
      url: `http://localhost:${steamMockPort}/health`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: process.env.CI ? "npm run start" : "npx next dev -p 3000",
      url: `http://localhost:3000${basePath}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
