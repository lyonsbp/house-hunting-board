-- Property price/status history.
-- One row per scrape (initial import + every subsequent refresh) so we can
-- detect deltas — price drops, status changes (active → pending → sold) —
-- and eventually plot a trajectory.
--
-- The live `properties` row stays as the canonical "current" state and is
-- still upserted on refresh; this table is the append-only audit trail.
-- Mirrors the read-policy posture of `properties`: globally readable to
-- authenticated users, server-only writes via service role.

create table public.property_snapshots (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  list_price  numeric,
  sold_price  numeric,
  status      text,
  scraped_at  timestamptz not null default now()
);

create index property_snapshots_recent_idx
  on public.property_snapshots(property_id, scraped_at desc);

alter table public.property_snapshots enable row level security;

create policy "property_snapshots: auth read"
  on public.property_snapshots
  for select
  using (auth.role() = 'authenticated');
