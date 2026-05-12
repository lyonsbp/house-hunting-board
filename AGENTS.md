<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# House Hunting Inspiration Board — agent / contributor guide

The product spec lives in [`PRD.md`](./PRD.md). Read it first when planning a
feature; it's the source of truth for scope, data model, and milestones.

## Stack

- **Next.js 16** (App Router) + **React 19** + TypeScript
- **Tailwind v4**
- **Supabase** — Postgres + Auth + Storage + Realtime (`@supabase/ssr`)
- **Cloudflare Workers** via `@opennextjs/cloudflare` for hosting (no Vercel)
- **Vitest** + Testing Library for unit tests

## Architecture (big picture)

Three runtimes, one Postgres:

1. **Next.js (App Router) on Cloudflare Workers** — the user-facing app.
   RSCs read directly from Supabase via the SSR client; mutations go
   through Server Actions or `src/app/api/*` route handlers.
2. **Supabase Postgres** — the source of truth and the **authorization
   boundary**. Every table that holds board content has RLS gated on
   `is_board_member(board_id)` / `has_board_role(board_id, role)` (defined
   in `supabase/migrations/0001_init.sql`). Never re-implement these checks
   in app code; let the DB reject.
3. **Standalone Cloudflare Workers under `workers/`** (future) — async jobs:
   listing scrapers, image-copy from Redfin/Zillow into Supabase Storage,
   LLM feature-signal extraction, AI image edits. Triggered by HTTP or
   Cloudflare Queues; the Next app enqueues, then receives push updates
   over the board's Supabase Realtime channel (`boards:{board_id}`).

Two cross-cutting code patterns to follow:

- **Polymorphic artifacts.** A single `artifacts` row can be an image,
  link, text, or note (`kind` column) with kind-specific extras living in
  the `metadata` jsonb. Add new kinds by extending the enum + a discriminated
  union in TS, not by sharding into new tables.
- **AI image edits behind an interface.** `ai_edits` records the lineage
  (parent → output, prompt, model, cost). The PRD calls for model
  swappability (Gemini 2.5 Flash Image as primary, FLUX Kontext fallback);
  put a single `ImageEditor` interface in `src/lib/ai/` and dispatch by
  model so the table column drives runtime selection.

Image storage is currently Supabase Storage (`artifacts/` bucket, signed
URLs). The wrangler config reserves an R2 binding for a possible later
swap; keep the storage layer abstracted so that swap is a one-file change.

## Conventions

- **Server Components by default.** Reach for `"use client"` only for
  interactive UI (drag/drop, forms, image editor canvas).
- **Mutations** go through Server Actions or route handlers in
  `src/app/api/*`, never directly from the browser bypassing RLS.
- **Auth boundary is Supabase RLS.** Don't write app-layer authorization
  checks instead of policies — keep the DB the source of truth.
- For server auth checks use `getClaims()` (verified) or `getUser()` (fresh).
  **Never** trust `getSession()` for authorization decisions.
- Heavy / async work (scrapers, image edits, feature extraction) runs in
  separate Cloudflare Workers triggered by HTTP or Queues, not in
  request-path Next routes.
- Keep schema changes in `supabase/migrations/` — never edit applied
  migrations; add a new one.

## Environment

- `.env.local` for `pnpm dev`; `.dev.vars` for `pnpm preview` (wrangler);
  `wrangler secret put <NAME>` for production. See `.env.local.example`.

## Verifying UI changes with the browser MCPs

Two MCP servers are wired up in `.mcp.json` so you can drive a real browser
against `localhost:3000`:

- **`playwright`** (`@playwright/mcp`) — scripted flows, screenshots, form fills.
- **`chrome-devtools`** (`chrome-devtools-mcp`) — perf, console, network inspection.

**When to use it.** Any change under `src/app/**` that affects rendered output,
click handlers, drag/drop, paste handling, or AI edits. Skip for pure refactors
when unit tests cover the behavior. Type-check + Vitest verify code; this
harness verifies the *feature*.

**Preconditions** (do not boot these yourself — ask the user if they're missing):

1. `pnpm exec supabase start` running (local Postgres on `:54321`).
2. `pnpm exec supabase db reset` has been applied at least once.
3. `pnpm dev` running on `:3000`.

**First-run setup.** `pnpm dev:seed` once. Prints the seeded user
(`test@local.dev`), board UUID, and the board URL. Idempotent — rerun any time.

**Per-session login.**

1. `pnpm dev:auth` → captures a fresh magic-link URL.
2. Playwright MCP `browser_navigate` to that URL → hits `/auth/callback` →
   lands logged in on `/`.
3. Save `storageState` to `.claude/playwright-storage.json` (gitignored). Reuse
   on subsequent calls; re-run `pnpm dev:auth` when 401s start appearing.

**Happy paths to exercise** (pick what your change touches):

1. Open seeded board → category tiles render.
2. Drill into a category → grid view loads.
3. Add an artifact (paste image, link, or note).
4. Drag a card between categories.
5. Toggle canvas mode → freeform drag.
6. Trigger AI edit on an image (only if you touched `ai-edit-actions.ts` or
   `src/lib/ai/`).

**What to capture.** Screenshot before/after, console errors, failed network
requests. Surface anything non-green to the user before claiming success.

**Chrome DevTools MCP** is better for: perf regressions, layout/paint issues,
network waterfall debugging, inspecting Supabase Realtime subscriptions.

**Honesty rule.** If the harness can't be reached (no dev server, no Supabase,
stale seed), say so explicitly rather than skipping verification silently.
