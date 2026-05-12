#!/usr/bin/env node
// Seed a known test user + board into the local Supabase stack so the browser
// MCPs can drive the app without OAuth or magic-link friction.
//
// Idempotent: rerunning prints the same board URL.
// Requires `pnpm exec supabase start` to be running.

import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const TEST_EMAIL = "test@local.dev";
const BOARD_NAME = "Test Board";

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

async function findOrCreateUser(admin) {
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const hit = data.users.find((u) => u.email === TEST_EMAIL);
    if (hit) return hit;
    if (data.users.length < 200) break;
    page += 1;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    email_confirm: true,
    user_metadata: { full_name: "Test User" },
  });
  if (error) throw error;
  return data.user;
}

async function findOrCreateBoard(admin, userId) {
  const existing = await admin
    .from("boards")
    .select("id")
    .eq("created_by", userId)
    .eq("name", BOARD_NAME)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data.id;

  const created = await admin
    .from("boards")
    .insert({ name: BOARD_NAME, created_by: userId })
    .select("id")
    .single();
  if (created.error) throw created.error;
  return created.data.id;
}

async function ensureOwnerMembership(admin, boardId, userId) {
  const { error } = await admin.from("board_members").upsert(
    { board_id: boardId, user_id: userId, role: "owner" },
    { onConflict: "board_id,user_id" },
  );
  if (error) throw error;
}

const { url, serviceKey } = readSupabaseLocalCreds();
const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const user = await findOrCreateUser(admin);
const boardId = await findOrCreateBoard(admin, user.id);
await ensureOwnerMembership(admin, boardId, user.id);

console.log(`user:  ${TEST_EMAIL} (${user.id})`);
console.log(`board: ${boardId}`);
console.log(`url:   http://localhost:3000/boards/${boardId}`);
