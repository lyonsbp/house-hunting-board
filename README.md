# House Hunting Inspiration Board

A vision-board / Pinterest-style app for tracking house-hunting inspiration —
images, links, notes — organized into user-defined categories (houses,
kitchens, backyards, pools…). Real-time collaborative so a couple can hunt
together. See [`PRD.md`](./PRD.md) for the full product spec.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4
- Supabase — Postgres, Auth, Storage, Realtime
- Cloudflare Workers (via `@opennextjs/cloudflare`) for hosting
- Vitest for unit tests

## Getting started

```bash
# Install
pnpm install

# Configure env
cp .env.local.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY, FLUX_API_KEY

# Bring up the local Supabase stack (requires Docker)
pnpm exec supabase start
pnpm exec supabase db reset      # apply migrations

# Run the app
pnpm dev
# → http://localhost:3000

# Tests
pnpm test
```

## Cloudflare deploy

```bash
# Local Workers preview (mirrors prod runtime)
pnpm preview

# Deploy
pnpm deploy
```

Deploy prerequisites:

1. `wrangler login`
2. Create the OpenNext cache R2 bucket:
   `wrangler r2 bucket create house-hunting-board-opennext-cache`
3. Set secrets:
   ```bash
   wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   wrangler secret put GEMINI_API_KEY
   wrangler secret put FLUX_API_KEY
   ```
4. Public Supabase config (`NEXT_PUBLIC_*`) lives in `wrangler.jsonc` under
   `vars` — set per-environment as needed.
5. Push DB migrations to the linked Supabase project before (or alongside)
   the first deploy that depends on them. `pnpm deploy` ships only the
   Worker bundle — DB schema changes are a separate step:
   ```bash
   pnpm exec supabase db push --linked
   ```
   Skipping this leaves the Worker hitting a Postgres without the
   columns/tables the new code expects, which surfaces as silently failing
   server actions (e.g. canvas drops not persisting because `canvas_x`
   doesn't exist yet).

## Routes

- `/boards/[id]` — dashboard of category tiles for a board.
- `/boards/[id]/c/[categorySlug]` — single-category drill-down. The slug
  is kebab-case from `categories.name` (computed on the fly, not stored
  in the DB). The sentinel `uncategorized` slug renders artifacts that
  have no category membership.
- `/boards/[id]/c/[categorySlug]?mode=canvas` — drill-down in freeform
  pin-board mode. Append `?debug=1` to either drill-down route to
  surface an on-screen DnD inspector for diagnosing drag-drop issues.

## Project layout

See [`AGENTS.md`](./AGENTS.md) for full conventions, file layout, and
contributor guide.
