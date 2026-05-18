#!/usr/bin/env tsx
/**
 * One-shot migration: copy `properties`, `property_snapshots`, and
 * `feature_signals` from a SOURCE Supabase project to a DEST Supabase
 * project, preserving the original UUIDs so foreign keys stay intact.
 *
 * Built specifically to recover from "I ran bulk-import while `.env.local`
 * was pointing at local Supabase, and I meant to write to hosted." No
 * board/artifact/storage data is copied — only the analytics dataset.
 *
 * Defaults:
 *   SOURCE = `.env.local`        (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
 *   DEST   = `.env.production`   (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
 *
 * Both files are gitignored, so the hosted service-role key can live in
 * `.env.production` safely. If you'd rather not put it on disk, set
 * `DEST_SUPABASE_SERVICE_ROLE_KEY=…` inline and it overrides the file.
 *
 *   pnpm migrate-to-hosted [--dry-run] [--reverse]
 *
 * Idempotent: inserts use `upsert(..., { ignoreDuplicates: true })` so a
 * partial run is safely re-executable. The unique key on `properties`
 * is `(source, source_url)` so the original UUID is preserved.
 */

import { existsSync } from "node:fs";
import { config as loadEnv } from "dotenv";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type ProjectCreds = { url: string; serviceKey: string };

function loadCredsFromFile(path: string): Partial<ProjectCreds> {
  if (!existsSync(path)) return {};
  const parsed = loadEnv({ path, processEnv: {} }).parsed ?? {};
  return {
    url: parsed.NEXT_PUBLIC_SUPABASE_URL,
    serviceKey: parsed.SUPABASE_SERVICE_ROLE_KEY,
  };
}

function resolveCreds(
  envPrefix: "SOURCE" | "DEST",
  envFile: string,
): ProjectCreds {
  const fromFile = loadCredsFromFile(envFile);
  const url = process.env[`${envPrefix}_SUPABASE_URL`] ?? fromFile.url;
  const serviceKey =
    process.env[`${envPrefix}_SUPABASE_SERVICE_ROLE_KEY`] ?? fromFile.serviceKey;
  if (!url || !serviceKey) {
    throw new Error(
      `Missing ${envPrefix} credentials. Provide either ${envPrefix}_SUPABASE_URL + ${envPrefix}_SUPABASE_SERVICE_ROLE_KEY inline, or NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in ${envFile}.`,
    );
  }
  return { url, serviceKey };
}

const READ_PAGE = 500;

function mkClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function fetchAll<T>(
  client: SupabaseClient,
  table: string,
  orderCol = "id",
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .order(orderCol, { ascending: true })
      .range(from, from + READ_PAGE - 1);
    if (error) throw new Error(`Read ${table} failed: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < READ_PAGE) break;
    from += READ_PAGE;
  }
  return out;
}

async function upsertBatched<T extends Record<string, unknown>>(
  dest: SupabaseClient,
  table: string,
  rows: T[],
  conflictCols: string,
  writeBatch: number,
): Promise<void> {
  let written = 0;
  for (let i = 0; i < rows.length; i += writeBatch) {
    const batch = rows.slice(i, i + writeBatch);
    const { error } = await dest
      .from(table)
      .upsert(batch, { onConflict: conflictCols, ignoreDuplicates: true });
    if (error) {
      throw new Error(`Write ${table} (batch ${i}..${i + batch.length}): ${error.message}`);
    }
    written += batch.length;
    process.stdout.write(`  ${table}: ${written}/${rows.length}\r`);
  }
  process.stdout.write("\n");
}

type PropRow = { id: string; source: string; source_url: string };
type ChildRow = { id: string; property_id: string };

/**
 * Build a map from a local property UUID to the hosted property UUID by
 * matching on (source, source_url). Properties already on hosted may
 * have been created by an earlier import under a different UUID; the
 * `ignoreDuplicates` upsert kept hosted's existing row, so we must
 * translate FK references before copying snapshots/signals.
 */
async function buildPropertyIdMap(
  source: SupabaseClient,
  dest: SupabaseClient,
): Promise<Map<string, string>> {
  const [local, hosted] = await Promise.all([
    fetchAll<PropRow>(source, "properties"),
    fetchAll<PropRow>(dest, "properties"),
  ]);
  const hostedByKey = new Map<string, string>();
  for (const h of hosted) {
    hostedByKey.set(`${h.source}|${h.source_url}`, h.id);
  }
  const map = new Map<string, string>();
  let missing = 0;
  for (const l of local) {
    const hostedId = hostedByKey.get(`${l.source}|${l.source_url}`);
    if (hostedId) map.set(l.id, hostedId);
    else missing++;
  }
  if (missing > 0) {
    throw new Error(
      `${missing} local properties have no matching hosted row — properties copy may have partially failed.`,
    );
  }
  return map;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const reverse = process.argv.includes("--reverse");

  const localCreds = resolveCreds("SOURCE", ".env.local");
  const hostedCreds = resolveCreds("DEST", ".env.production");

  // `--reverse` swaps the direction so the same script can pull a fresh
  // snapshot back from hosted into local for offline testing.
  const sourceCreds = reverse ? hostedCreds : localCreds;
  const destCreds = reverse ? localCreds : hostedCreds;

  if (sourceCreds.url === destCreds.url) {
    throw new Error("source and dest URLs are identical — refusing to copy to self.");
  }

  const source = mkClient(sourceCreds.url, sourceCreds.serviceKey);
  const dest = mkClient(destCreds.url, destCreds.serviceKey);

  console.log(
    `Migrating analytics data${dryRun ? " (dry-run)" : ""}.\n` +
      `  source: ${sourceCreds.url}\n` +
      `  dest:   ${destCreds.url}\n`,
  );

  // Step 1: copy properties. `properties.raw` is ~600KB per row (full
  // scraped JSON payload) so PostgREST + the 8s statement_timeout can't
  // swallow big upserts — keep this batch tiny.
  console.log("copying properties");
  const localProps = await fetchAll<Record<string, unknown>>(source, "properties");
  if (dryRun) {
    console.log(`  read ${localProps.length}, would write ${localProps.length}.`);
  } else {
    await upsertBatched(dest, "properties", localProps, "source,source_url", 5);
    console.log(`  read ${localProps.length}, wrote ${localProps.length}.`);
  }

  // Step 2: build local-id → hosted-id map. Required because the
  // properties upsert keeps hosted's existing UUID on conflict
  // (ignoreDuplicates), so the FKs in our local snapshots/signals don't
  // resolve as-is on hosted.
  console.log("mapping property ids");
  const propIdMap = dryRun
    ? new Map<string, string>()
    : await buildPropertyIdMap(source, dest);
  console.log(`  ${propIdMap.size} ids mapped.`);

  // Step 3: copy snapshots and feature_signals with translated FKs. We
  // drop the local `id` so hosted assigns a fresh UUID, and to keep the
  // migration idempotent across re-runs we first delete any hosted rows
  // for the property_ids we're about to write. Scoped per-property so we
  // never touch rows for properties not in this migration.
  const hostedPropIds = [...propIdMap.values()];
  for (const child of ["property_snapshots", "feature_signals"] as const) {
    console.log(`copying ${child}`);
    const rows = await fetchAll<ChildRow & Record<string, unknown>>(source, child);
    if (dryRun) {
      console.log(`  read ${rows.length}, would write ${rows.length}.`);
      continue;
    }
    // Clear any prior partial-run writes for these properties.
    for (let i = 0; i < hostedPropIds.length; i += 100) {
      const slice = hostedPropIds.slice(i, i + 100);
      const { error: delErr } = await dest.from(child).delete().in("property_id", slice);
      if (delErr) {
        throw new Error(`Cleanup ${child} (slice ${i}): ${delErr.message}`);
      }
    }
    const translated = rows
      .map((r) => {
        const hostedPid = propIdMap.get(r.property_id);
        if (!hostedPid) return null;
        const copy: Record<string, unknown> = { ...r };
        delete copy.id;
        copy.property_id = hostedPid;
        return copy;
      })
      .filter((r): r is Record<string, unknown> => r !== null);
    await upsertBatched(dest, child, translated, "id", 500);
    console.log(`  read ${rows.length}, wrote ${translated.length}.`);
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
