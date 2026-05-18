#!/usr/bin/env tsx
/**
 * One-shot backfill: copy existing image artifact bytes from Supabase
 * Storage to Cloudflare R2, generating thumb/display variants on the way.
 * After this completes, every image artifact has `storage_backend='r2'`
 * and a populated `metadata.variants` map, so reads serve from R2's
 * immutable-cached custom domain with zero Supabase egress.
 *
 * Why a Node script (not a Worker): sharp's native bindings are an order
 * of magnitude faster than WASM for batch CPU like this. R2 has an
 * S3-compatible API, so we sign and PUT directly without needing a
 * Worker runtime.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-r2.ts [--dry-run] [--limit=N] [--purge-supabase]
 *
 * Resumable: state lives in `scripts/backfill-r2.state.json` and records
 * the last `created_at` cursor + per-row outcomes. Rerun after a crash
 * and it'll pick up where it left off.
 *
 * Required env (loaded from .env.local by default):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   R2_ACCOUNT_ID
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET_NAME           (e.g. "house-hunting-board-artifacts")
 *   R2_PUBLIC_BASE           (e.g. "https://img.example.com")
 *
 * --purge-supabase: separate destructive pass that runs AFTER backfill
 * has converged. For every row already on R2, deletes the legacy
 * Supabase object and nulls `storage_path`. Wait ~7 days before running
 * to keep a rollback window.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { AwsClient } from "aws4fetch";
import { config as loadEnv } from "dotenv";
import sharp from "sharp";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const STATE_PATH = resolve(process.cwd(), "scripts/backfill-r2.state.json");
const PAGE_SIZE = 50;
const THUMB_LONG_EDGE = 400;
const DISPLAY_LONG_EDGE = 1200;
const THUMB_QUALITY = 60;
const DISPLAY_QUALITY = 70;

type Args = {
  dryRun: boolean;
  limit: number | null;
  purgeSupabase: boolean;
};

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let limit: number | null = null;
  for (const a of args) {
    if (a.startsWith("--limit=")) {
      const n = Number(a.slice("--limit=".length));
      if (Number.isFinite(n) && n > 0) limit = Math.floor(n);
    }
  }
  return {
    dryRun: args.includes("--dry-run"),
    limit,
    purgeSupabase: args.includes("--purge-supabase"),
  };
}

// ---------------------------------------------------------------------------
// State file (resumability)
// ---------------------------------------------------------------------------

type State = {
  /** Last `created_at` we successfully advanced past. */
  cursor: string | null;
  succeeded: number;
  failed: number;
  /** Per-row error log; bounded to last 50 entries to keep file tidy. */
  recentErrors: { id: string; reason: string; at: string }[];
};

function loadState(): State {
  if (!existsSync(STATE_PATH)) {
    return { cursor: null, succeeded: 0, failed: 0, recentErrors: [] };
  }
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8")) as State;
  } catch {
    return { cursor: null, succeeded: 0, failed: 0, recentErrors: [] };
  }
}

function saveState(s: State): void {
  s.recentErrors = s.recentErrors.slice(-50);
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

// ---------------------------------------------------------------------------
// Env + clients
// ---------------------------------------------------------------------------

function loadEnvFiles(): void {
  loadEnv({ path: resolve(process.cwd(), ".env.local") });
  loadEnv({ path: resolve(process.cwd(), ".env.production") });
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

function makeSupabase(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function makeR2() {
  const accountId = requireEnv("R2_ACCOUNT_ID");
  const bucket = requireEnv("R2_BUCKET_NAME");
  const client = new AwsClient({
    accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    service: "s3",
    region: "auto",
  });
  const base = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;
  return { client, base, bucket };
}

// ---------------------------------------------------------------------------
// Key + content-hash helpers (mirror src/lib/storage/types.ts)
// ---------------------------------------------------------------------------

type Variant = "thumb" | "display" | "original";

function buildKey(hash: string, variant: Variant, ext: string): string {
  return `v1/${hash.slice(0, 2)}/${hash}/${variant}.${ext}`;
}

function mimeToExt(mime: string): string {
  switch (mime.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/avif":
      return "avif";
    default:
      return "jpg";
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// ---------------------------------------------------------------------------
// R2 ops
// ---------------------------------------------------------------------------

type R2 = ReturnType<typeof makeR2>;

async function r2Head(r2: R2, key: string): Promise<boolean> {
  const res = await r2.client.fetch(`${r2.base}/${key}`, { method: "HEAD" });
  return res.status === 200;
}

async function r2Put(
  r2: R2,
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  // Cast to BodyInit — Node 22's fetch accepts Uint8Array but the lib
  // types here still don't include it.
  const res = await r2.client.fetch(`${r2.base}/${key}`, {
    method: "PUT",
    body: body as unknown as BodyInit,
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`R2 PUT ${key} failed: ${res.status} ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Encode (sharp → AVIF)
// ---------------------------------------------------------------------------

async function encodeVariants(buf: Buffer): Promise<{
  thumb: Buffer;
  display: Buffer;
  width: number;
  height: number;
}> {
  const meta = await sharp(buf).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  // `fit: inside` + `withoutEnlargement` matches the browser path's
  // scale-down semantics: small images pass through, large ones shrink
  // to fit the long-edge target.
  const [thumb, display] = await Promise.all([
    sharp(buf)
      .resize({
        width: THUMB_LONG_EDGE,
        height: THUMB_LONG_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .avif({ quality: THUMB_QUALITY })
      .toBuffer(),
    sharp(buf)
      .resize({
        width: DISPLAY_LONG_EDGE,
        height: DISPLAY_LONG_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .avif({ quality: DISPLAY_QUALITY })
      .toBuffer(),
  ]);

  return { thumb, display, width, height };
}

// ---------------------------------------------------------------------------
// Main backfill loop
// ---------------------------------------------------------------------------

type ArtifactRow = {
  id: string;
  storage_path: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

async function fetchPage(
  supabase: SupabaseClient,
  cursor: string | null,
  pageSize: number,
): Promise<ArtifactRow[]> {
  let q = supabase
    .from("artifacts")
    .select("id, storage_path, metadata, created_at")
    .eq("kind", "image")
    .eq("storage_backend", "supabase")
    .order("created_at", { ascending: true })
    .limit(pageSize);
  if (cursor) q = q.gt("created_at", cursor);
  const { data, error } = await q;
  if (error) throw new Error(`Supabase select failed: ${error.message}`);
  return (data ?? []) as ArtifactRow[];
}

async function processRow(
  supabase: SupabaseClient,
  r2: R2,
  row: ArtifactRow,
  dryRun: boolean,
): Promise<void> {
  if (!row.storage_path) {
    throw new Error("legacy row has no storage_path");
  }

  // Resumability: an earlier run may have populated variants but failed
  // to flip storage_backend. Re-check before re-uploading.
  const existingVariants = (row.metadata as { variants?: Record<string, { key?: string }> } | null)
    ?.variants;
  if (existingVariants?.original?.key) {
    return;
  }

  const { data: blob, error: dlError } = await supabase.storage
    .from("artifacts")
    .download(row.storage_path);
  if (dlError || !blob) {
    throw new Error(dlError?.message ?? "Supabase download failed");
  }
  const sourceMime = blob.type || "image/jpeg";
  const buf = Buffer.from(await blob.arrayBuffer());
  const contentHash = sha256Hex(new Uint8Array(buf));
  const originalExt = mimeToExt(sourceMime);

  const thumbKey = buildKey(contentHash, "thumb", "avif");
  const displayKey = buildKey(contentHash, "display", "avif");
  const originalKey = buildKey(contentHash, "original", originalExt);

  if (dryRun) {
    console.log(
      `[dry-run] ${row.id} → ${contentHash.slice(0, 12)}… (${buf.byteLength}B)`,
    );
    return;
  }

  // Encode + upload (skip per-variant if already present, e.g. another
  // board uploaded the same Redfin photo earlier).
  const { thumb, display, width, height } = await encodeVariants(buf);

  if (!(await r2Head(r2, originalKey))) {
    await r2Put(r2, originalKey, new Uint8Array(buf), sourceMime);
  }
  if (!(await r2Head(r2, thumbKey))) {
    await r2Put(r2, thumbKey, new Uint8Array(thumb), "image/avif");
  }
  if (!(await r2Head(r2, displayKey))) {
    await r2Put(r2, displayKey, new Uint8Array(display), "image/avif");
  }

  const variants = {
    thumb: { key: thumbKey, ext: "avif" },
    display: { key: displayKey, ext: "avif" },
    original: { key: originalKey, ext: originalExt },
  };

  const newMetadata = {
    ...(row.metadata ?? {}),
    width,
    height,
    variants,
  };

  const { error: updateError } = await supabase
    .from("artifacts")
    .update({
      storage_backend: "r2",
      content_hash: contentHash,
      metadata: newMetadata,
    })
    .eq("id", row.id);
  if (updateError) {
    throw new Error(`UPDATE failed: ${updateError.message}`);
  }
}

async function runBackfill(args: Args): Promise<void> {
  const supabase = makeSupabase();
  const r2 = makeR2();
  const state = loadState();

  console.log(
    `Starting backfill. Cursor: ${state.cursor ?? "(start)"}. ` +
      `Done so far: ${state.succeeded} ok, ${state.failed} failed.`,
  );

  let processed = 0;
  while (true) {
    if (args.limit !== null && processed >= args.limit) break;

    const remaining = args.limit !== null ? args.limit - processed : PAGE_SIZE;
    const page = await fetchPage(supabase, state.cursor, Math.min(PAGE_SIZE, remaining));
    if (page.length === 0) break;

    for (const row of page) {
      try {
        await processRow(supabase, r2, row, args.dryRun);
        state.succeeded += 1;
      } catch (e) {
        state.failed += 1;
        state.recentErrors.push({
          id: row.id,
          reason: e instanceof Error ? e.message : String(e),
          at: new Date().toISOString(),
        });
        console.warn(
          `  ✗ ${row.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      // Advance cursor regardless of success — failed rows stay on
      // storage_backend='supabase', so they'll be retried only on a
      // fresh run where we reset the cursor manually.
      state.cursor = row.created_at;
      processed += 1;
      if (processed % 10 === 0) saveState(state);
      if (args.limit !== null && processed >= args.limit) break;
    }
    saveState(state);
    console.log(`  processed ${processed} (cursor ${state.cursor})`);
  }

  saveState(state);
  console.log(
    `Done. Total: ${state.succeeded} ok, ${state.failed} failed.`,
  );
}

// ---------------------------------------------------------------------------
// Purge pass
// ---------------------------------------------------------------------------

async function runPurge(): Promise<void> {
  const supabase = makeSupabase();
  console.log("Purging Supabase Storage objects for migrated rows…");

  // Process in pages. We need rows that are now on R2 but still have a
  // dangling storage_path pointing at Supabase.
  let purged = 0;
  let cursor: string | null = null;
  while (true) {
    let q = supabase
      .from("artifacts")
      .select("id, storage_path, created_at")
      .eq("kind", "image")
      .eq("storage_backend", "r2")
      .not("storage_path", "is", null)
      .order("created_at", { ascending: true })
      .limit(PAGE_SIZE);
    if (cursor) q = q.gt("created_at", cursor);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    const paths = data
      .map((r) => r.storage_path)
      .filter((p): p is string => !!p);
    if (paths.length > 0) {
      const { error: rmError } = await supabase.storage
        .from("artifacts")
        .remove(paths);
      if (rmError) {
        console.warn(`  remove() failed: ${rmError.message}`);
      } else {
        purged += paths.length;
      }
    }

    const ids = data.map((r) => r.id);
    await supabase
      .from("artifacts")
      .update({ storage_path: null })
      .in("id", ids);

    cursor = data[data.length - 1]!.created_at;
    console.log(`  purged ${purged} so far`);
  }
  console.log(`Done. Purged ${purged} Supabase Storage objects.`);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function main() {
  loadEnvFiles();
  const args = parseArgs();
  if (args.purgeSupabase) {
    await runPurge();
  } else {
    await runBackfill(args);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
