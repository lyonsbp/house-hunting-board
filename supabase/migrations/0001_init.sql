-- House-Hunting Inspiration Board — initial schema (M0).
-- See PRD.md §4 (Data Model) and §6 (Architecture / RLS).

create extension if not exists "pgcrypto";

----------------------------------------------------------------------
-- Boards & membership
----------------------------------------------------------------------

create table public.boards (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid not null references auth.users(id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create type public.board_role as enum ('owner', 'editor', 'viewer');

create table public.board_members (
  board_id   uuid not null references public.boards(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.board_role not null default 'editor',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

create index board_members_user_idx on public.board_members(user_id);

-- Helper: is the calling user a member of the given board (optionally with min role)?
create or replace function public.is_board_member(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.board_members
    where board_id = p_board_id and user_id = auth.uid()
  );
$$;

create or replace function public.has_board_role(p_board_id uuid, p_min_role public.board_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.board_members
    where board_id = p_board_id
      and user_id = auth.uid()
      and case p_min_role
        when 'viewer' then role in ('viewer', 'editor', 'owner')
        when 'editor' then role in ('editor', 'owner')
        when 'owner'  then role = 'owner'
      end
  );
$$;

----------------------------------------------------------------------
-- Categories (per-board taxonomy)
----------------------------------------------------------------------

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.boards(id) on delete cascade,
  name        text not null,
  color       text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  unique (board_id, name)
);

create index categories_board_idx on public.categories(board_id);

----------------------------------------------------------------------
-- Artifacts (image | link | text | note)
----------------------------------------------------------------------

create type public.artifact_kind as enum ('image', 'link', 'text', 'note');

create table public.artifacts (
  id           uuid primary key default gen_random_uuid(),
  board_id     uuid not null references public.boards(id) on delete cascade,
  kind         public.artifact_kind not null,
  -- For 'image': storage_path points into the Supabase Storage bucket.
  storage_path text,
  -- For 'link': source URL.
  url          text,
  -- For 'text' / 'note': free-form body. Also stores image captions / link previews.
  body         text,
  -- Polymorphic extras: dimensions, OG metadata, scrape source, ai-edit lineage, etc.
  metadata     jsonb not null default '{}'::jsonb,
  created_by   uuid not null references auth.users(id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index artifacts_board_idx on public.artifacts(board_id);
create index artifacts_kind_idx  on public.artifacts(board_id, kind);

----------------------------------------------------------------------
-- Many-to-many: artifacts ↔ categories
----------------------------------------------------------------------

create table public.artifact_categories (
  artifact_id uuid not null references public.artifacts(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  sort_order  int not null default 0,
  primary key (artifact_id, category_id)
);

create index artifact_categories_category_idx on public.artifact_categories(category_id);

----------------------------------------------------------------------
-- Tags (free-form secondary axis)
----------------------------------------------------------------------

create table public.tags (
  id       uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  name     text not null,
  unique (board_id, name)
);

create table public.artifact_tags (
  artifact_id uuid not null references public.artifacts(id) on delete cascade,
  tag_id      uuid not null references public.tags(id) on delete cascade,
  primary key (artifact_id, tag_id)
);

----------------------------------------------------------------------
-- Comments
----------------------------------------------------------------------

create table public.comments (
  id          uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.artifacts(id) on delete cascade,
  author_id   uuid not null references auth.users(id) on delete restrict,
  body        text not null,
  created_at  timestamptz not null default now()
);

create index comments_artifact_idx on public.comments(artifact_id);

----------------------------------------------------------------------
-- Listing import: properties + signals
----------------------------------------------------------------------

create table public.properties (
  id              uuid primary key default gen_random_uuid(),
  source          text not null,                       -- 'redfin' | 'zillow' | 'mls' | …
  source_url      text not null,
  source_id       text,                                -- vendor-side id when known
  address         text,
  city            text,
  state           text,
  zip             text,
  list_price      numeric,
  sold_price      numeric,
  bedrooms        int,
  bathrooms       numeric,
  sqft            int,
  lot_sqft        int,
  year_built      int,
  status          text,                                -- 'active' | 'pending' | 'sold' …
  raw             jsonb not null default '{}'::jsonb,  -- full vendor payload
  scraped_at      timestamptz not null default now(),
  unique (source, source_url)
);

create index properties_zip_idx     on public.properties(zip);
create index properties_geo_idx     on public.properties(state, city);

-- Map artifacts back to a source property (an image came from this listing).
create table public.property_artifacts (
  property_id uuid not null references public.properties(id) on delete cascade,
  artifact_id uuid not null references public.artifacts(id) on delete cascade,
  primary key (property_id, artifact_id)
);

-- Tags extracted from listing descriptions ("waterfall island", "ADU", etc.)
-- feeding price-analytics queries.
create table public.feature_signals (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references public.properties(id) on delete cascade,
  feature      text not null,
  source       text not null,                          -- 'llm-extract' | 'manual' | …
  confidence   numeric,
  created_at   timestamptz not null default now(),
  unique (property_id, feature, source)
);

create index feature_signals_feature_idx on public.feature_signals(feature);

----------------------------------------------------------------------
-- AI image edits / remixes
----------------------------------------------------------------------

create table public.ai_edits (
  id                 uuid primary key default gen_random_uuid(),
  parent_artifact_id uuid not null references public.artifacts(id) on delete cascade,
  output_artifact_id uuid references public.artifacts(id) on delete set null,
  prompt             text not null,
  model              text not null,                    -- 'gemini-2.5-flash-image' | 'flux-kontext' | …
  variant_index      int not null default 0,           -- for "remix" fan-outs
  cost_cents         int,
  status             text not null default 'pending',  -- 'pending' | 'succeeded' | 'failed'
  error              text,
  created_by         uuid not null references auth.users(id) on delete restrict,
  created_at         timestamptz not null default now()
);

create index ai_edits_parent_idx on public.ai_edits(parent_artifact_id);

----------------------------------------------------------------------
-- updated_at triggers
----------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger boards_updated_at    before update on public.boards    for each row execute function public.touch_updated_at();
create trigger artifacts_updated_at before update on public.artifacts for each row execute function public.touch_updated_at();

----------------------------------------------------------------------
-- Row-Level Security
----------------------------------------------------------------------

alter table public.boards              enable row level security;
alter table public.board_members       enable row level security;
alter table public.categories          enable row level security;
alter table public.artifacts           enable row level security;
alter table public.artifact_categories enable row level security;
alter table public.tags                enable row level security;
alter table public.artifact_tags       enable row level security;
alter table public.comments            enable row level security;
alter table public.properties          enable row level security;
alter table public.property_artifacts  enable row level security;
alter table public.feature_signals     enable row level security;
alter table public.ai_edits            enable row level security;

-- Boards: members can read; only members with editor+ can update; only owner can delete.
create policy "boards: members read"     on public.boards for select using (public.is_board_member(id));
create policy "boards: any user inserts" on public.boards for insert with check (auth.uid() = created_by);
create policy "boards: editor updates"   on public.boards for update using (public.has_board_role(id, 'editor'));
create policy "boards: owner deletes"    on public.boards for delete using (public.has_board_role(id, 'owner'));

-- board_members: a user can see rows for boards they belong to. Only owners can mutate membership.
create policy "members: read own boards" on public.board_members for select using (public.is_board_member(board_id));
create policy "members: owner mutates"   on public.board_members for all using (public.has_board_role(board_id, 'owner')) with check (public.has_board_role(board_id, 'owner'));

-- Auto-add the creator as owner on board insert.
create or replace function public.add_creator_as_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.board_members(board_id, user_id, role, invited_by)
  values (new.id, new.created_by, 'owner', new.created_by);
  return new;
end; $$;

create trigger boards_add_creator_owner
  after insert on public.boards
  for each row execute function public.add_creator_as_owner();

-- Generic policy template for board-scoped tables.
create policy "categories: member rw" on public.categories
  for all using (public.is_board_member(board_id)) with check (public.has_board_role(board_id, 'editor'));

create policy "artifacts: member read" on public.artifacts
  for select using (public.is_board_member(board_id));
create policy "artifacts: editor write" on public.artifacts
  for insert with check (public.has_board_role(board_id, 'editor') and created_by = auth.uid());
create policy "artifacts: editor update" on public.artifacts
  for update using (public.has_board_role(board_id, 'editor'));
create policy "artifacts: editor delete" on public.artifacts
  for delete using (public.has_board_role(board_id, 'editor'));

create policy "artifact_categories: via artifact" on public.artifact_categories
  for all using (
    exists (select 1 from public.artifacts a where a.id = artifact_id and public.is_board_member(a.board_id))
  ) with check (
    exists (select 1 from public.artifacts a where a.id = artifact_id and public.has_board_role(a.board_id, 'editor'))
  );

create policy "tags: member rw" on public.tags
  for all using (public.is_board_member(board_id)) with check (public.has_board_role(board_id, 'editor'));

create policy "artifact_tags: via artifact" on public.artifact_tags
  for all using (
    exists (select 1 from public.artifacts a where a.id = artifact_id and public.is_board_member(a.board_id))
  ) with check (
    exists (select 1 from public.artifacts a where a.id = artifact_id and public.has_board_role(a.board_id, 'editor'))
  );

create policy "comments: member read" on public.comments
  for select using (
    exists (select 1 from public.artifacts a where a.id = artifact_id and public.is_board_member(a.board_id))
  );
create policy "comments: editor write" on public.comments
  for insert with check (
    exists (select 1 from public.artifacts a where a.id = artifact_id and public.has_board_role(a.board_id, 'editor'))
    and author_id = auth.uid()
  );
create policy "comments: author deletes" on public.comments
  for delete using (author_id = auth.uid());

-- Properties + feature_signals are intentionally globally readable to authenticated users
-- (they back cross-board price analytics). Writes are server-only via service-role.
create policy "properties: auth read"        on public.properties        for select using (auth.role() = 'authenticated');
create policy "feature_signals: auth read"   on public.feature_signals   for select using (auth.role() = 'authenticated');

-- property_artifacts is board-scoped via the linked artifact.
create policy "property_artifacts: via artifact" on public.property_artifacts
  for all using (
    exists (select 1 from public.artifacts a where a.id = artifact_id and public.is_board_member(a.board_id))
  ) with check (
    exists (select 1 from public.artifacts a where a.id = artifact_id and public.has_board_role(a.board_id, 'editor'))
  );

-- ai_edits inherit access from the parent artifact's board.
create policy "ai_edits: via parent" on public.ai_edits
  for all using (
    exists (select 1 from public.artifacts a where a.id = parent_artifact_id and public.is_board_member(a.board_id))
  ) with check (
    exists (select 1 from public.artifacts a where a.id = parent_artifact_id and public.has_board_role(a.board_id, 'editor'))
    and created_by = auth.uid()
  );

----------------------------------------------------------------------
-- Realtime
----------------------------------------------------------------------

alter publication supabase_realtime add table
  public.boards,
  public.board_members,
  public.categories,
  public.artifacts,
  public.artifact_categories,
  public.tags,
  public.artifact_tags,
  public.comments,
  public.ai_edits;
