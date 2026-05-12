import { execSync } from "node:child_process";
import { test as setup, expect } from "@playwright/test";

const TEST_EMAIL = "test@local.dev";
const AUTH_FILE = "tests/e2e/.auth/user.json";
const MAILPIT_URL = "http://127.0.0.1:54324";

// Logs in as the seeded test user once per test run and stashes the resulting
// cookies in tests/e2e/.auth/user.json so the other projects can reuse them
// via Playwright's `storageState`.
//
// PKCE matters here: /auth/callback requires the verifier cookie that
// signInWithOtp sets on the browser that submitted the /login form. So the
// flow is: submit the form, poll Mailpit for the emailed magic link, then
// navigate to it in the SAME context.
setup("authenticate as seeded test user", async ({ page }) => {
  execSync("pnpm dev:seed", { stdio: "inherit" });

  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: "DELETE" });

  await page.goto("/login");
  await page.getByRole("textbox", { name: /email/i }).fill(TEST_EMAIL);
  await page.getByRole("button", { name: /send magic link/i }).click();
  await expect(page.getByText(/Check.*for a sign-in link/i)).toBeVisible();

  const link = execSync("node scripts/dev-auth.mjs", {
    encoding: "utf8",
  }).trim();

  await page.goto(link);
  await expect(
    page.getByRole("heading", { name: "Your boards" }),
  ).toBeVisible();

  await page.context().storageState({ path: AUTH_FILE });
});
