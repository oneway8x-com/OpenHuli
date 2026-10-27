import { defineConfig, devices } from "@playwright/test";
import { getTestDatabaseUrl } from "../../scripts/test-database";

const databaseUrl = getTestDatabaseUrl();
const baseURL = "http://127.0.0.1:3100";
process.env.DATABASE_URL = databaseUrl;
process.env.DIRECT_DATABASE_URL = databaseUrl;

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  // The development server compiles a route on its first request.
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "pnpm --dir ../.. --filter @corely/app dev --hostname 127.0.0.1 --port 3100",
    url: `${baseURL}/todos`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: databaseUrl,
      DIRECT_DATABASE_URL: databaseUrl,
      NEXT_PUBLIC_API_BASE_URL: "",
      CORELY_DEV_TENANT_ID: "e2e-fallback-unused",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
  timeout: 60_000,
});
