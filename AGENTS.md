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
pnpm cf:build         # OpenNext: build for Cloudflare Workers
pnpm preview          # Build + run locally on Workers via wrangler
pnpm deploy           # Build + deploy to Cloudflare
pnpm cf-typegen       # Generate CloudflareEnv types from wrangler.jsonc

# Local Supabase (Postgres + Auth + Storage + Realtime in Docker)
pnpm exec supabase start
pnpm exec supabase db reset      # re-apply all migrations from scratch
pnpm exec supabase migration new <name>
```

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
