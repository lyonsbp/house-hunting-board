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
| `artifact_categories` | Many-to-many; an image can be both *kitchen* and *island*. |
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

### 5.2 Listing Import — Redfin / Zillow (M2)

User pastes a listing URL → backend extracts metadata + images → user picks
which images to keep → picked images are copied to Supabase Storage so they
outlive the listing.

Two-tier strategy:

1. **API tier (preferred where licensed)**
   Zillow's public API is heavily gated; realistic options are partner APIs
   (Bridge Interactive, RapidAPI listings vendors, RentSpree, etc.). We'll
   spike cost/access during M2.
2. **Scraper tier (fallback, async)**
   Cloudflare Worker fetches the page. Static-HTML pages parse with
   `cheerio`; JS-rendered pages route to a headless service (Browserless or
   self-hosted Playwright). Job is queued via Cloudflare Queues; the user
   sees an "importing…" state and gets a Realtime push when ready.

Build both. The API tier is faster and cleaner when licensed; the scraper
is the durable fallback (and the only option for delisted properties).

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

### 5.4 Price Analytics (post-MVP, schema-prepared at MVP)

Goal: answer questions like *"how much does X feature cost on average?"* —
e.g. waterfall island, ADU, finished basement.

Approach: every imported `properties` row gets passed through an LLM
feature-extractor that emits `feature_signals` rows against a curated
taxonomy. Then we run hedonic regression (price ~ sqft + beds + baths +
features…) or simpler group-by/cohort comparisons in the analytics UI.

We capture `properties` + `feature_signals` rows starting at MVP so the
dataset accumulates well before the analytics UI ships.

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

## 7. Privacy & Legal

- Scraping Zillow/Redfin has ToS risk. Posture: personal-use saving, not
  redistribution; show a clear notice; never expose scraped images to
  non-board-members.
- Store `source_url` + `scraped_at` on every imported artifact for
  provenance.
- Cross-board analytics queries operate on `properties` / `feature_signals`
  only — never expose user-specific board content across users.

## 8. Open Questions

- Which Zillow/Redfin/MLS API tier (if any) to license at launch?
- AI cost guardrails: per-user monthly budget cap? show running cost in UI?
- Does the price-analytics dataset need to be cross-user (privacy review)?
  Initial answer: yes, but only the property/feature data, never artifacts.
- Mobile-first vs desktop-first layout for v1 (board feels native to both).
- Image-similarity search via pgvector — worth adding now, or wait?

## 9. Milestones

| | Scope |
|---|---|
| **M0** | Scaffold (this commit): Next.js + Supabase + Cloudflare + Vitest, schema in place |
| **M1** | Core board: categories + artifacts + Realtime + invites |
| **M2** | Listing import: URL paste → image picker (API tier + scraper fallback) |
| **M3** | AI image edit + Remix |
| **M4** | Feature-signal extraction (background worker) |
| **M5** | Price analytics UI |
