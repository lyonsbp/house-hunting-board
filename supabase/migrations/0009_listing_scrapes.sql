-- Listing-scrape audit + rate-limit log.
-- One row per `previewListing` invocation, written before we hit the
-- scraper / Scrapfly. The action counts rows for the current user against
-- LISTING_SCRAPE_DAILY_LIMIT (env-configurable). Users in the
-- SUPERADMIN_EMAILS env list bypass the count.
--
-- This intentionally does NOT track commit attempts — a successful preview
-- is what costs us money via Scrapfly, and a single preview yields N image
-- downloads which use Zillow's open CDN, not the proxy.

create table public.listing_scrapes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  source      text not null,
  source_url  text,
  -- 'preview' for now; 'commit' or other phases can be added later.
  status      text not null default 'preview',
  created_at  timestamptz not null default now()
);

create index listing_scrapes_user_recent_idx
  on public.listing_scrapes(user_id, created_at desc);

alter table public.listing_scrapes enable row level security;

-- Users can only ever see their own scrape history.
create policy "listing_scrapes: self read"
  on public.listing_scrapes
  for select using (user_id = auth.uid());

-- Insert is restricted to the calling user inserting rows about themselves.
create policy "listing_scrapes: self insert"
  on public.listing_scrapes
  for insert with check (user_id = auth.uid());
