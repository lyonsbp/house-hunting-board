import { createClient } from "@supabase/supabase-js";

/**
 * Daily cleanup of ephemeral AI-edit reference uploads.
 *
 * Path layout (set by `src/app/boards/[id]/ai-ref-actions.ts`):
 *   ref_uploads/<user_id>/<uuid>.<ext>
 *
 * RLS for that prefix (migration 0014) only lets the owner read/write.
 * This worker runs with the service-role key so it can list every
 * user's prefix and remove anything older than `REF_TTL_HOURS`.
 *
 * Decoupled from the main OpenNext worker so request-path code never
 * sees the service-role key in its env. Bind both with separate
 * `wrangler secret put SUPABASE_SERVICE_ROLE_KEY --name <worker>`.
 */

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  REF_TTL_HOURS: string;
}

// Minimal local types — `@cloudflare/workers-types` isn't installed for
// this side worker; both shapes here are the documented public API
// surface (cron trigger event + waitUntil escape hatch).
interface CronExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

const BUCKET = "artifacts";
const PREFIX = "ref_uploads";
const PAGE_SIZE = 1000;

const handler = {
  async scheduled(
    _event: { cron: string; scheduledTime: number },
    env: Env,
    ctx: CronExecutionContext,
  ) {
    ctx.waitUntil(sweep(env));
  },
  // Manual trigger via `curl https://<worker>` for testing — no auth, but
  // the worker has no public route by default; bind to a hidden URL or
  // remove this fetch handler entirely once verified in production.
  async fetch(_req: Request, env: Env) {
    const summary = await sweep(env);
    return new Response(JSON.stringify(summary), {
      headers: { "content-type": "application/json" },
    });
  },
};

export default handler;

async function sweep(env: Env): Promise<{ scanned: number; deleted: number }> {
  const ttlHours = Number.parseInt(env.REF_TTL_HOURS, 10) || 24;
  const cutoffMs = Date.now() - ttlHours * 60 * 60 * 1000;

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // List all user prefixes under ref_uploads/. Storage `list` is
  // single-folder so we walk: ref_uploads/ → user folders → files.
  const { data: userFolders, error: folderError } = await supabase.storage
    .from(BUCKET)
    .list(PREFIX, { limit: PAGE_SIZE });
  if (folderError) {
    console.error("[gc-ref-uploads] list user folders failed", folderError);
    return { scanned: 0, deleted: 0 };
  }

  let scanned = 0;
  const toDelete: string[] = [];

  for (const folder of userFolders ?? []) {
    if (!folder.name) continue;
    const userPrefix = `${PREFIX}/${folder.name}`;
    let offset = 0;
    while (true) {
      const { data: files, error } = await supabase.storage
        .from(BUCKET)
        .list(userPrefix, { limit: PAGE_SIZE, offset });
      if (error) {
        console.error("[gc-ref-uploads] list files failed", userPrefix, error);
        break;
      }
      if (!files || files.length === 0) break;
      for (const f of files) {
        scanned += 1;
        const created = parseStorageTimestamp(f.created_at) ?? parseStorageTimestamp(f.updated_at);
        if (created !== null && created < cutoffMs) {
          toDelete.push(`${userPrefix}/${f.name}`);
        }
      }
      if (files.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }

  // Batch deletes — Supabase Storage `remove` accepts an array.
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += 500) {
    const batch = toDelete.slice(i, i + 500);
    const { error } = await supabase.storage.from(BUCKET).remove(batch);
    if (error) {
      console.error("[gc-ref-uploads] remove batch failed", error);
      continue;
    }
    deleted += batch.length;
  }

  console.log(
    `[gc-ref-uploads] sweep complete — scanned=${scanned} deleted=${deleted} ttl=${ttlHours}h`,
  );
  return { scanned, deleted };
}

function parseStorageTimestamp(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}
