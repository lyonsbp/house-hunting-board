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

## Commands

```bash
pnpm dev              # Next.js dev server (turbopack, http://localhost:3000)
pnpm test             # Vitest, single run
pnpm test:watch       # Vitest in watch mode
pnpm lint             # ESLint
pnpm build            # Next.js production build
pnpm cf:build         # OpenNext: build for Cloudflare Workers
pnpm preview          # Build + run locally on Workers via wrangler
pnpm deploy           # Build + deploy to Cloudflare
pnpm cf-typegen       # Generate CloudflareEnv types from wrangler.jsonc

# Run a single test file or a single test by name
pnpm test path/to/file.test.ts
pnpm test -t "partial test name"

# Local Supabase (Postgres + Auth + Storage + Realtime in Docker; needs Docker running)
pnpm exec supabase start
pnpm exec supabase db reset      # re-apply all migrations from scratch
pnpm exec supabase migration new <name>
pnpm exec supabase stop
```

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

## Layout

```
src/
  app/                  # Next.js App Router routes
  lib/
    supabase/
      client.ts         # browser client (anon key)
      server.ts         # SSR/RSC client (cookie-bound)
    __tests__/          # colocated tests (also accepted: *.test.ts next to source)
supabase/
  migrations/           # SQL migrations — append-only, never edit applied ones
  config.toml
workers/                # (future) Cloudflare Workers for scrape/queue/AI jobs
open-next.config.ts     # OpenNext adapter config
wrangler.jsonc          # Cloudflare Worker config + bindings
vitest.config.ts        # Vitest config
```

## Environment

- Copy `.env.local.example` → `.env.local` for `pnpm dev`.
- Copy the same values into `.dev.vars` for `pnpm preview` (wrangler reads
  this when running locally on Workers).
- Production secrets: `wrangler secret put <NAME>`.
