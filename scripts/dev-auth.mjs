#!/usr/bin/env node
// Mint a one-shot magic-link URL for the seeded test user. Pipe the URL into
// Playwright MCP's browser_navigate to land authenticated against localhost:3000.
//
// Requires `pnpm exec supabase start` running and `pnpm dev:seed` to have been
// run at least once.

import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const TEST_EMAIL = "test@local.dev";
const REDIRECT_TO = "http://localhost:3000/auth/callback";

function readSupabaseLocalCreds() {
  const raw = execSync("pnpm exec supabase status -o env", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const env = Object.fromEntries(
    raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^[A-Z_][A-Z0-9_]*=/.test(line))
      .map((line) => {
        const eq = line.indexOf("=");
        return [line.slice(0, eq), line.slice(eq + 1).replace(/^"|"$/g, "")];
      }),
  );
  const url = env.API_URL;
  const serviceKey = env.SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Could not read API_URL / SERVICE_ROLE_KEY from `supabase status`. Is the local stack running?",
    );
  }
  return { url, serviceKey };
}

const { url, serviceKey } = readSupabaseLocalCreds();
const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email: TEST_EMAIL,
  options: { redirectTo: REDIRECT_TO },
});
if (error) throw error;

const link = data.properties?.action_link;
if (!link) {
  throw new Error("generateLink returned no action_link");
}
console.log(link);
