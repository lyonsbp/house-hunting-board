#!/usr/bin/env tsx
/**
 * Bulk-import Redfin / Zillow listings into the `properties` /
 * `property_snapshots` / `feature_signals` tables — no images, no
 * artifacts, no board involvement. Purely stocks the price-analytics
 * dataset (PRD §5.4).
 *
 * Usage:
 *   pnpm bulk-import urls.txt [--limit N] [--dry-run]
 *
 * `urls.txt` is one URL per line; blank lines and lines starting with
 * `#` are skipped. Run pairs nicely with the bookmarklets in
 * `scripts/bookmarklets/` for extracting favorites lists.
 *
 * Idempotent: re-running with the same urls.txt no-ops the property
 * upsert (unique on `source, source_url`) and re-runs the LLM extractor
 * (which deletes prior 'llm-extract' rows before re-inserting).
 */

import { readFileSync } from "node:fs";
import { argv, exit } from "node:process";

// tsx autoloads `.env.local` from CWD before user code runs, so by the
// time the modules below read process.env the keys are already there.

import { runExtraction } from "@/lib/listings/feature-extract";
import {
  insertSnapshotsFromPreview,
  upsertPropertyFromPreview,
} from "@/lib/listings/bulk";
import { getFetcher } from "@/lib/listings/registry";
import {
  ListingFetchError,
  UnsupportedListingError,
} from "@/lib/listings/types";
import { createAdminClient } from "@/lib/supabase/admin";

const DELAY_BASE_MS = 8_000;
const DELAY_JITTER_MS = 4_000;

type Args = {
  file: string;
  limit?: number;
  dryRun: boolean;
};

function parseArgs(): Args {
  const positional: string[] = [];
  const opts: { limit?: number; dryRun: boolean } = { dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--limit") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error("--limit requires a positive integer");
      }
      opts.limit = Math.floor(n);
    } else if (a.startsWith("--")) {
      throw new Error(`Unknown flag: ${a}`);
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 1) {
    throw new Error(
      "Usage: pnpm bulk-import <urls.txt> [--limit N] [--dry-run]",
    );
  }
  return { file: positional[0]!, ...opts };
}

function readUrls(path: string): string[] {
  const raw = readFileSync(path, "utf8");
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function jitteredDelay(): number {
  // base ± jitter, e.g. 8000 ± 4000 → 4000..12000
  return DELAY_BASE_MS + Math.floor((Math.random() * 2 - 1) * DELAY_JITTER_MS);
}

function fmtAddr(p: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
}): string {
  const parts = [p.address, [p.city, p.state].filter(Boolean).join(", ")].filter(
    Boolean,
  );
  return parts.length > 0 ? parts.join(", ") : "(no address)";
}

function fmtPrice(n?: number | null): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "n/a";
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

async function importOne(
  admin: ReturnType<typeof createAdminClient> | null,
  url: string,
  dryRun: boolean,
): Promise<{ ok: true; propertyId?: string; written?: number } | { ok: false; reason: string }> {
  let fetcher;
  try {
    fetcher = getFetcher(url);
  } catch (e) {
    if (e instanceof UnsupportedListingError) {
      return { ok: false, reason: `unsupported host (${e.host})` };
    }
    return { ok: false, reason: e instanceof Error ? e.message : "fetcher lookup failed" };
  }

  let preview;
  try {
    preview = await fetcher.fetchAndParse(url);
  } catch (e) {
    if (e instanceof ListingFetchError) return { ok: false, reason: `${e.code}: ${e.message}` };
    return { ok: false, reason: e instanceof Error ? e.message : "fetch failed" };
  }

  if (dryRun || !admin) {
    console.log(
      `  preview: ${fmtAddr(preview.property)} — list ${fmtPrice(preview.property.listPrice)} / sold ${fmtPrice(preview.property.soldPrice)} — ${preview.images.length} images`,
    );
    return { ok: true };
  }

  const upserted = await upsertPropertyFromPreview(admin, preview);
  if ("error" in upserted) return { ok: false, reason: upserted.error };

  await insertSnapshotsFromPreview(admin, upserted.id, preview);

  const extracted = await runExtraction(upserted.id);
  if ("error" in extracted) {
    // Property + snapshots are saved; just note the extractor miss and
    // keep going. The caller can re-run extraction later.
    console.warn(`  warn  feature extraction failed: ${extracted.error}`);
    return { ok: true, propertyId: upserted.id };
  }
  return { ok: true, propertyId: upserted.id, written: extracted.written };
}

async function main() {
  const args = parseArgs();
  const urls = readUrls(args.file);
  const total = args.limit ? Math.min(urls.length, args.limit) : urls.length;
  if (total === 0) {
    console.log(`No URLs found in ${args.file}.`);
    return;
  }

  // Dry-run never writes, so the Supabase keys are optional. For a real
  // run, fail fast before we burn Scrapfly credits scraping a listing we
  // can't insert.
  if (
    !args.dryRun &&
    (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
  ) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
  }
  const admin = args.dryRun ? null : createAdminClient();

  console.log(
    `Importing ${total} listing${total === 1 ? "" : "s"}${args.dryRun ? " (dry-run)" : ""} from ${args.file}.`,
  );
  console.log(
    `Delay between listings: ${DELAY_BASE_MS}ms ± ${DELAY_JITTER_MS}ms.\n`,
  );

  let succeeded = 0;
  let failed = 0;
  for (let i = 0; i < total; i++) {
    const url = urls[i]!;
    const label = `[${i + 1}/${total}]`;
    console.log(`${label} ${url}`);
    const result = await importOne(admin, url, args.dryRun);
    if (result.ok) {
      succeeded++;
      if (!args.dryRun) {
        const tail = result.written !== undefined ? ` (${result.written} features)` : "";
        console.log(`  ok    property ${result.propertyId ?? "?"}${tail}`);
      }
    } else {
      failed++;
      console.log(`  fail  ${result.reason}`);
    }

    if (i < total - 1) {
      const ms = jitteredDelay();
      console.log(`  … sleeping ${ms}ms`);
      await sleep(ms);
    }
  }

  console.log(`\nDone: ${succeeded} succeeded, ${failed} failed, ${total} total.`);
  exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  exit(2);
});
