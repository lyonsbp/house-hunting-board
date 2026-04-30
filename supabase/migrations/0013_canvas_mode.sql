-- 0013_canvas_mode.sql
--
-- Phase 2 of the board redesign — per-category Canvas mode. A drill-down
-- view can flip between the existing grid and a freeform "pin board"
-- where each card has an (x, y) coordinate and is dragged into place.
--
-- Positions are stored on `artifact_categories` so they're naturally
-- per-(artifact, category): the same artifact pinned to two different
-- categories has independent positions in each. The existing
-- "artifact_categories: via artifact" RLS policy covers reads + writes
-- for both members and public viewers, so no new policy is needed.
--
-- canvas_w / canvas_h are reserved for a future "resize cards on the
-- canvas" feature; the MVP uses a uniform card size driven entirely
-- from app code. Defining the columns now lets us add resize without
-- another migration.
--
-- Floating user-drawn labels (a separate `canvas_labels` table called
-- out in the plan) are intentionally NOT in this migration — labels
-- need their own UI surface and ship later.

alter table public.artifact_categories
  add column canvas_x  real,
  add column canvas_y  real,
  add column canvas_w  real,
  add column canvas_h  real;

-- Partial index speeds up the "any positions seeded for this category?"
-- check used by the lazy-seed path. Without it, that check would scan
-- the whole row group for the category.
create index artifact_categories_canvas_seeded_idx
  on public.artifact_categories(category_id)
  where canvas_x is not null;
