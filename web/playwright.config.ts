// Playwright E2E for the web quote page only (SPEC.md - Repo and process).
// Runs against the live Supabase project via the service role, so launch
// with the repo-root env loaded:
//   cd web && set -a && source ../.env && set +a && pnpm test:e2e

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/global-setup.ts",
  globalTeardown: "./tests/global-teardown.ts",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:3111",
  },
  webServer: {
    command: "pnpm exec next dev -p 3111",
    url: "http://localhost:3111",
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
  },
});
