# House Hunting Inspiration Board — PRD

## 1. Summary

A house-hunting inspiration / tracking board. Vision-board / Pinterest-style
collection of artifacts (images, links, text, notes) categorized however the
user wants — houses, kitchens, backyards, pools, etc. Artifacts can belong to
one or many categories (a single picture can be both *kitchen* and *waterfall
island*). Boards are real-time collaborative so partners/spouses can build a
shared wishlist during the hunt.

The bigger idea is to capture inspiration **durably**: when a Redfin/Zillow
listing is sold, the photos disappear. This app lets you paste a listing URL,
pick the images that matter, and keep them long after the listing is gone —
plus build up a dataset that can answer questions like *"how much does a
waterfall island add to a home's price?"* and let you riff on a backyard
photo with AI ("show me this with a small pool and a tanning ledge").

## 2. Goals & Non-Goals

**Goals**

- Capture inspiration durably (images survive listing deletion).
- Organize freely with user-defined categories + free-form tags.
- Ingest Redfin/Zillow listings via URL paste and let the user cherry-pick
  images.
- Surface insights from the accumulated dataset (price-by-feature analytics).
- Edit images with AI to visualize "what if" changes; remix to see N variants.
- Real-time collaboration on a shared board (couple, agent, etc.).

**Non-goals (for now)**

- MLS broker integration / direct buyer–agent workflow.
- Mortgage / affordability / closing-cost tooling.
- In-app messaging beyond per-artifact comments.
- Mobile-native apps (web is responsive; native is later).

## 3. Personas

- **Active hunter** — actively shopping, pastes Redfin/Zillow links daily.
- **Dreamer** — saving inspo for a future build/remodel; light on listings,
  heavy on standalone images.
- **Couple** — two users on one shared board; must stay in sync live.

## 4. Data Model

Full schema lives in [`supabase/migrations/0001_init.sql`](./supabase/migrations/0001_init.sql).
Summary:

| Table | Purpose |
|---|---|
| `boards` | Top-level workspace (e.g. "2026 Move"). |
| `board_members` | user ↔ board with role (`owner` / `editor` / `viewer`). |
| `categories` | Per-board taxonomy (houses, kitchens, …); user-defined. |
| `artifacts` | Polymorphic: `image` / `link` / `text` / `note`. Holds storage path, URL, body, and a `metadata` jsonb for kind-specific extras. |
| `artifact_categories` | Many-to-many; an image can be both *kitchen* and *island*. Holds canvas-mode position columns (`canvas_x`, `canvas_y`, `canvas_w`, `canvas_h`) so a card pinned to two categories has independent freeform positions in each (migration `0013`). |
| `tags`, `artifact_tags` | Free-form secondary axis. |
| `comments` | Per-artifact discussion. |
| `properties` | Scraped Redfin/Zillow listing metadata. |
| `property_artifacts` | Links artifacts back to source property (for analytics + provenance). |
| `feature_signals` | `(property_id, feature, source, confidence)` — feeds price-analytics queries (e.g. "waterfall island", "ADU"). |
| `ai_edits` | Generated image edits — parent artifact, prompt, model, output, cost. |

**RLS**: every board-scoped table is gated by `is_board_member(board_id)` /
`has_board_role(board_id, role)`. `properties` and `feature_signals` are
globally readable to authenticated users so analytics can span boards;
writes there are server-only via the service role.

## 5. Features

### 5.1 Core Board (M1)

- Create boards; invite members by email (Supabase Auth).
- Add artifacts: image upload, paste link (with OG-tag preview), paste text,
  paste note.
- Drag-drop into one or many categories; reorder within a category.
- Free-form tags as a second axis.
- Comments per artifact.
- Real-time updates via Supabase Realtime channel `boards:{board_id}`.

### 5.1a Board organization UX (M6 — drill-down dashboard)

The board page is a **dashboard of category tiles**, not a single long
canvas. Each tile shows the category name, an item count, and a 2×2
preview strip (top 4 thumbnails by `sort_order`). On desktop, the
thumbnails fan out into a "hand of cards" on hover; on touch they sit
as a stacked deck. An "Uncategorized" sentinel tile appears when there
are artifacts with no category. Click a tile → drill into a focused
single-category view.

Drill-down route: `/boards/[id]/c/[categorySlug]`. The slug is
kebab-case (`Modern Kitchens` → `modern-kitchens`), computed on the
fly from `categories.name` — no DB column, so renaming a category
takes effect on the next request. The Uncategorized view uses a
sentinel slug `uncategorized`.

Cross-category drag in the drill-down is handled by a **swim-lane
drop panel** that slides up from the bottom of the viewport during a
drag. Each row is a useDroppable target showing the destination
category name + a thumbnail peek; drops dispatch to
`assign`/`unassign` server actions. Targeting uses cursor magnet
zones extending 100px upward from each row's top, with the lowermost
chip in the cursor's zone winning so selection progresses naturally
as the user drags toward the panel. Two terminal rows live at the
bottom: **+ New category** (opens a name modal that creates the
category, moves the dragged artifact into it, and redirects to the
new drill-down) and **Remove from category** (clears the assignment).

### 5.1b Canvas mode (M7 — freeform pin board)

Inside a drill-down, a `[Grid | Canvas]` toggle (URL: `?mode=canvas`)
flips the layout from the responsive grid to a freeform pin board.
Cards have absolute `(canvas_x, canvas_y)` positions stored on the
`artifact_categories` row, so the same artifact pinned to two
categories has independent positions in each. First-time canvas entry
**lazy-seeds** unpositioned cards into a 4-wide grid driven by
`sort_order`, idempotent via a `canvas_x is null` filter so partial
layouts are preserved. A **Reset layout** button re-seeds every card
in tidy grid order. The canvas viewport is **vertically resizable**
via the browser's native `resize: vertical` handle; pan is the
container's native scroll. Canvas mode is unsupported on the
Uncategorized view (no `artifact_categories` row to attach a
position to) — the toggle is hidden there.

Realtime collab is automatic: position writes flow through the
existing `artifact_categories` Supabase Realtime subscription; a
partner moving a card triggers `router.refresh()` on the other
client and the new positions render. Canvas v1 ships without
freeform user-drawn section labels, pan/zoom transforms, or
per-card resize handles — those are the next iteration.

### 5.2 Listing Import — Redfin / Zillow (M2)

User pastes a listing URL → backend extracts metadata + images → user picks
which images to keep → picked images are copied to Supabase Storage so they
outlive the listing.

**Scraper-only at launch.** A Cloudflare Worker fetches the page;
static-HTML pages parse with `cheerio`, JS-rendered pages route to a
headless service (Browserless or self-hosted Playwright). Jobs queue via
Cloudflare Queues; the user sees an "importing…" state and gets a Realtime
push when ready.

Licensed API tiers (Bridge Interactive, RapidAPI listings vendors, etc.)
are deferred — access requires MLS sponsorship or unproven third-party
vendors, and the scraper is the only viable path for delisted properties
anyway (which is the durable-capture core of the product). Revisit once we
know which fields we actually depend on.

### 5.3 AI Image Editing & AI Remix (M3)

Two use cases:

- **Edit**: "Add a small pool with a tanning ledge to this backyard."
  Input = source image + prompt. Output = one edited image, saved as a
  child artifact linked to the parent via `ai_edits`.
- **Remix**: "Show 4 variations of this kitchen with different cabinet
  colors." Input = source image + prompt + N. Output = a gallery the user
  picks from; chosen variants become artifacts.

#### Model options — pros / cons

| Model | Strength | Weakness | Est. cost / image |
|---|---|---|---|
| **Gemini 2.5 Flash Image** ("nano-banana") | Excellent identity-preserving edits + instruction following; cheap; multi-image input | Newer; less community tooling | ~$0.04 |
| **FLUX.1 Kontext** (BFL / Replicate) | Best-in-class for "edit this exact photo" with structural fidelity | Slightly costlier; rate limits | ~$0.05–0.08 |
| **OpenAI gpt-image-1** | Strong general edits, good text rendering, mature SDKs | Pricier; stricter content policy | ~$0.04–0.19 |
| **Stable Diffusion + ControlNet** (Replicate) | Fully tunable, cheapest at scale | Most plumbing; lower instruction-following | ~$0.01 |

**Recommendation**: start with **Gemini 2.5 Flash Image** as primary
(best price/quality for identity-preserving edits) with **FLUX Kontext** as
fallback for harder structural edits. Abstract behind an `ImageEditor`
interface so the model is swappable per-request and we can A/B per use case.

A third backend behind the same `ImageEditor` interface targets a **local
ComfyUI server** running open-weights models (FLUX.1 Kontext [dev],
Qwen-Image-Edit) on developer hardware. Used for prompt iteration and
taxonomy work without burning cloud spend, and as a possible self-hosted
tier later. The Worker reaches it via an OpenAI-compatible proxy
(LiteLLM) so the cloud and local code paths are identical.

#### Cost guardrails

Per-user cap of **10 AI image invocations per rolling 7 days** (an Edit
counts as 1; a Remix of N variants counts as N). Counter derived from
`ai_edits` rows by `created_by` + `created_at`. The editor UI shows
remaining quota for the week and disables submit at zero. No dollar-based
billing yet — invocation count is a simpler proxy and easier to explain.

### 5.4 Price Analytics (post-MVP, schema-prepared at MVP)

Goal: answer questions like *"how much does X feature cost on average?"* —
e.g. waterfall island, ADU, finished basement.

Approach: every imported `properties` row gets passed through an LLM
feature-extractor that emits `feature_signals` rows against a curated
taxonomy. Then we run hedonic regression (price ~ sqft + beds + baths +
features…) or simpler group-by/cohort comparisons in the analytics UI.

We capture `properties` + `feature_signals` rows starting at MVP so the
dataset accumulates well before the analytics UI ships.

Image-similarity search via pgvector is deferred until M4: the per-image
LLM feature-extraction pass is already iterating every image then and can
piggyback embeddings cheaply. Backfilling over the accumulated corpus at
that point is acceptable.

## 6. Architecture

```
Browser (Next.js client + RSC)
   │
   ├── Supabase JS SDK ── Realtime over WS ── Postgres (RLS)
   │
   └── /api/* (Next routes on OpenNext / CF Workers)
          ├── /api/import       → enqueue scrape job
          ├── /api/ai/edit      → call Gemini/FLUX, write to Storage
          └── /api/ai/remix     → fan-out N variations

Cloudflare Workers (cron + queue consumers)
   ├── Scraper jobs (Redfin/Zillow)
   ├── Image-copy jobs (listing → Supabase Storage)
   └── Feature-signal extractor (LLM tag pass)
```

- **Auth**: Supabase Auth — magic-link email to start; OAuth providers later.
- **Storage**: Supabase Storage bucket `artifacts/`, private, signed URLs.
  Switch to Cloudflare R2 later if image egress dominates costs (the
  storage layer is abstracted in the app).
- **Realtime**: one channel per board (`boards:{board_id}`).
- **Hosting**: Cloudflare Workers via `@opennextjs/cloudflare` (no Vercel).
- **Layout target**: desktop-first for v1 — drag-drop categorization, the
  scraped-listing image picker, and the AI editor canvas are all
  desktop-shaped. Mobile gets a read + quick-add path (paste link, snap
  photo, comment) so couples browsing Zillow on phones can capture; full
  board editing happens on desktop.

## 7. Privacy & Legal

- Scraping Zillow/Redfin has ToS risk. Posture: personal-use saving, not
  redistribution; show a clear notice; never expose scraped images to
  non-board-members.
- Store `source_url` + `scraped_at` on every imported artifact for
  provenance.
- Cross-board analytics queries operate on `properties` / `feature_signals`
  only — never expose user-specific board content across users.
- `feature_signals` rows must reference **only** `property_id` — never
  `board_id` or `artifact_id` — so there is no join path from a globally-
  readable analytics row back to a user or board.

## 8. Milestones

| | Scope |
|---|---|
| **M0** | Scaffold: Next.js + Supabase + Cloudflare + Vitest, schema in place |
| **M1** | Core board: categories + artifacts + Realtime + invites |
| **M2** | Listing import: URL paste → image picker (scraper) |
| **M3** | AI image edit + Remix |
| **M4** | Feature-signal extraction (background worker) |
| **M5** | Price analytics UI (cohort table + per-metro filter + chip drilldown) |
| **M6** | Drill-down dashboard: category-tile dashboard + nested slug route + swim-lane drop panel + fan-out hover + click-after-drag guard |
| **M7** | Canvas mode: per-category freeform pin board + lazy seed-from-grid + reset + resizable viewport (migration `0013`) |
