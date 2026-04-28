-- Distinguish snapshots that we observed by polling (`scrape`) from
-- listing-history events extracted from Redfin/Zillow's own price-history
-- payload (`listing`). Both sources live in the same table so the prior-
-- snapshot lookup in the listings panel can find whichever event is most
-- recent regardless of provenance.

alter table public.property_snapshots
  add column source text not null default 'scrape';

-- Helps the page-level "find prior snapshot" query that filters by
-- property_id and orders by scraped_at desc.
create index property_snapshots_source_idx
  on public.property_snapshots(property_id, source);
