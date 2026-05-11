-- Per-category "favorites" for artifacts. Editors star a card within a
-- specific category; favorites render before non-favorites in that
-- category's drill-down view. Shared across the board (not per-user).

alter table public.artifact_categories
  add column is_favorite boolean not null default false;

-- Supports the drill-down's "favorites first, then sort_order" ordering
-- without a separate sort. is_favorite is rendered in PG as "f"/"t", so
-- descending puts true ahead of false.
create index if not exists artifact_categories_category_favorite_sort_idx
  on public.artifact_categories (category_id, is_favorite desc, sort_order asc);
