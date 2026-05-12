#!/usr/bin/env node
// Print the most-recent magic-link URL sent to the dev test user.
//
// Why poll mail instead of `admin.generateLink`: the app's /auth/callback only
// accepts the PKCE `?code=` flow, and that flow requires a verifier cookie
// that was set when the BROWSER initiated `signInWithOtp`. admin-generated
// links use the implicit flow and fail. So the harness drives the real /login
// form first (which sets the verifier cookie), then this script grabs the
// resulting link out of Mailpit.
//
// Preconditions:
//   1. `pnpm exec supabase start` running (Mailpit on :54324).
//   2. The harness has already POSTed the /login form for TEST_EMAIL in the
//      browser session it will reuse to navigate to the printed link.

const TEST_EMAIL = "test@local.dev";
const MAILPIT_URL = "http://127.0.0.1:54324";
const POLL_MS = 250;
const TIMEOUT_MS = 10_000;

const linkRegex =
  /https?:\/\/127\.0\.0\.1:54321\/auth\/v1\/verify\?[^"\s)]+/;

async function fetchLatestMessageId() {
  const url = `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(
    `to:${TEST_EMAIL}`,
  )}&limit=1`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Mailpit search failed: ${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  return body.messages?.[0]?.ID ?? null;
}

async function fetchMessageBody(id) {
  const res = await fetch(`${MAILPIT_URL}/api/v1/message/${id}`);
  if (!res.ok) {
    throw new Error(`Mailpit fetch failed: ${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  return `${body.HTML ?? ""}\n${body.Text ?? ""}`;
}

const deadline = Date.now() + TIMEOUT_MS;
let id = null;
while (Date.now() < deadline) {
  id = await fetchLatestMessageId();
  if (id) break;
  await new Promise((r) => setTimeout(r, POLL_MS));
}
if (!id) {
  console.error(
    `No magic-link email found for ${TEST_EMAIL} within ${TIMEOUT_MS}ms.`,
  );
  console.error(
    "Did the harness submit the /login form first? (See AGENTS.md playbook.)",
  );
  process.exit(1);
}

const body = await fetchMessageBody(id);
const match = body.match(linkRegex);
if (!match) {
  console.error("Found an email but no verify URL in body.");
  console.error(body.slice(0, 500));
  process.exit(1);
}
console.log(match[0].replace(/&amp;/g, "&"));
