import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import path from "node:path";

// Mirror Next.js's env precedence so either file works for local testing.
for (const file of [
  ".env.development.local",
  ".env.local",
  ".env.development",
  ".env",
]) {
  loadEnv({ path: path.resolve(__dirname, file), quiet: true });
}

const AUTH_FILE = "tests/e2e/.auth/user.json";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const isDefaultLocal = !process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: AUTH_FILE,
      },
      dependencies: ["setup"],
    },
  ],
  webServer: isDefaultLocal
    ? {
        command: "pnpm dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
});
