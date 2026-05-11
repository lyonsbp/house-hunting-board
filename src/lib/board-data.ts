import { getCurrentUser } from "@/lib/auth";
import { toArtifact, type Artifact, type ArtifactRow } from "@/lib/artifacts";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import {
  CANVAS_CARD_H,
  CANVAS_CARD_W,
  CANVAS_GAP,
  UNCATEGORIZED_ID,
  type CanvasPosition,
} from "./board-data-shared";

export {
  CANVAS_CARD_H,
  CANVAS_CARD_W,
  CANVAS_GAP,
  UNCATEGORIZED_ID,
  type CanvasPosition,
};

type ServerClient = Awaited<ReturnType<typeof createClient>>;

// ---------------------------------------------------------------------------
// Board core: board row + viewer's role + canEdit/isOwner
// ---------------------------------------------------------------------------

export type BoardRole = "owner" | "editor" | "viewer" | null;

export type BoardCore = {
  board: { id: string; name: string; isPublic: boolean };
  userId: string | null;
  role: BoardRole;
  canEdit: boolean;
  isOwner: boolean;
  members: { user_id: string; role: string }[];
};

export async function loadBoardCore(
  supabase: ServerClient,
  boardId: string,
): Promise<BoardCore | null> {
  const user = await getCurrentUser();
  const userId = user?.sub ?? null;

  const [{ data: board }, { data: memberRows }] = await Promise.all([
    supabase
      .from("boards")
      .select("id, name, is_public")
      .eq("id", boardId)
      .maybeSingle(),
    supabase.from("board_members").select("user_id, role").eq("board_id", boardId),
  ]);

  if (!board) return null;

  const members = memberRows ?? [];
  const role: BoardRole = userId
    ? ((members.find((m) => m.user_id === userId)?.role as BoardRole) ?? null)
    : null;
  const isOwner = role === "owner";
  const canEdit = role === "owner" || role === "editor";

  return {
    board: { id: board.id, name: board.name, isPublic: board.is_public },
    userId,
    role,
    canEdit,
    isOwner,
    members,
  };
}

// ---------------------------------------------------------------------------
// Dashboard summary: per-category tile data (id, name, count, top-4 thumbs)
// ---------------------------------------------------------------------------

export type CategoryTile = {
  /** category UUID, or UNCATEGORIZED_ID for the sentinel tile */
  id: string;
  name: string;
  count: number;
  /** Up to 4 image storage paths to render as overlapped thumbs. */
  thumbnailPaths: string[];
};

export type DashboardSummary = {
  tiles: CategoryTile[];
};

/**
 * Loads the dashboard tile grid in 3 RLS-gated queries (categories,
 * artifacts, memberships) and groups in memory.
 *
 * Bounded payload: every artifact on the board × ~5 small columns. We
 * deliberately don't try to compute per-category window-limits in SQL —
 * the dataset per board is small and grouping in JS is simpler.
 */
export async function loadDashboardSummary(
  supabase: ServerClient,
  boardId: string,
): Promise<DashboardSummary> {
  const [
    { data: categories },
    { data: artifacts },
    { data: memberships },
  ] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name")
      .eq("board_id", boardId)
      .order("sort_order")
      .order("name"),
    supabase
      .from("artifacts")
      .select("id, kind, storage_path, created_at")
      .eq("board_id", boardId)
      .order("created_at", { ascending: false }),
    supabase
      .from("artifact_categories")
      .select(
        "artifact_id, category_id, sort_order, artifacts!inner(board_id)",
      )
      .eq("artifacts.board_id", boardId),
  ]);

  type ArtifactInfo = {
    id: string;
    kind: string;
    storagePath: string | null;
    createdAt: string;
  };
  const byArtifact = new Map<string, ArtifactInfo>();
  for (const a of artifacts ?? []) {
    byArtifact.set(a.id, {
      id: a.id,
      kind: a.kind,
      storagePath: a.storage_path,
      createdAt: a.created_at,
    });
  }

  // Group memberships by category, sorted by sort_order ascending.
  const byCat = new Map<string, { artifactId: string; sortOrder: number }[]>();
  for (const m of memberships ?? []) {
    const list = byCat.get(m.category_id) ?? [];
    list.push({ artifactId: m.artifact_id, sortOrder: m.sort_order });
    byCat.set(m.category_id, list);
  }

  const categorizedIds = new Set(
    (memberships ?? []).map((m) => m.artifact_id),
  );

  function pickThumbnails(orderedArtifactIds: string[]): string[] {
    const paths: string[] = [];
    for (const id of orderedArtifactIds) {
      if (paths.length >= 4) break;
      const info = byArtifact.get(id);
      if (!info || info.kind !== "image" || !info.storagePath) continue;
      paths.push(info.storagePath);
    }
    return paths;
  }

  const tiles: CategoryTile[] = [];

  for (const c of categories ?? []) {
    const ms = (byCat.get(c.id) ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const artifactIds = ms.map((m) => m.artifactId);
    tiles.push({
      id: c.id,
      name: c.name,
      count: artifactIds.length,
      thumbnailPaths: pickThumbnails(artifactIds),
    });
  }

  // Uncategorized = board artifacts with no membership. Already sorted
  // by created_at desc from the artifacts query.
  const uncatIds = (artifacts ?? [])
    .filter((a) => !categorizedIds.has(a.id))
    .map((a) => a.id);
  if (uncatIds.length > 0) {
    tiles.push({
      id: UNCATEGORIZED_ID,
      name: "Uncategorized",
      count: uncatIds.length,
      thumbnailPaths: pickThumbnails(uncatIds),
    });
  }

  return { tiles };
}

// ---------------------------------------------------------------------------
// Drill-down: full-detail view for a single category (or uncategorized)
// ---------------------------------------------------------------------------

export type ArtifactProvenance = {
  address: string | null;
  city: string | null;
  state: string | null;
  sourceUrl: string;
};

export type CategoryDrillDown = {
  /** null = the Uncategorized sentinel view */
  category: { id: string; name: string } | null;
  artifacts: Artifact[];
  /**
   * Memberships across the *whole* board for the artifacts in scope, so
   * the per-card Categorize panel still shows every category the
   * artifact belongs to (not just this one).
   */
  membershipsByArtifact: Record<
    string,
    { categoryId: string; sortOrder: number; isFavorite: boolean }[]
  >;
  tagsByArtifact: Record<string, { id: string; name: string }[]>;
  allTags: { id: string; name: string }[];
  allCategories: { id: string; name: string }[];
  provenanceByArtifact: Record<string, ArtifactProvenance>;
  signedImageUrls: Record<string, string>;
};

/**
 * Returns null when `categoryId` doesn't resolve (wrong board, RLS hidden,
 * etc.). Caller should `notFound()` in that case.
 *
 * `categoryId === UNCATEGORIZED_ID` is the sentinel for "artifacts with
 * no category membership."
 */
export async function loadCategoryDrillDown(
  supabase: ServerClient,
  boardId: string,
  categoryId: string,
): Promise<CategoryDrillDown | null> {
  let category: { id: string; name: string } | null = null;
  if (categoryId !== UNCATEGORIZED_ID) {
    const { data: row } = await supabase
      .from("categories")
      .select("id, name")
      .eq("id", categoryId)
      .eq("board_id", boardId)
      .maybeSingle();
    if (!row) return null;
    category = row;
  }

  // Step 1: figure out which artifact ids are in scope.
  let scopedArtifactIds: string[];
  if (categoryId === UNCATEGORIZED_ID) {
    const [{ data: allArtifacts }, { data: allMemberships }] = await Promise.all([
      supabase
        .from("artifacts")
        .select("id, created_at")
        .eq("board_id", boardId)
        .order("created_at", { ascending: false }),
      supabase
        .from("artifact_categories")
        .select("artifact_id, artifacts!inner(board_id)")
        .eq("artifacts.board_id", boardId),
    ]);
    const cat = new Set((allMemberships ?? []).map((m) => m.artifact_id));
    scopedArtifactIds = (allArtifacts ?? [])
      .filter((a) => !cat.has(a.id))
      .map((a) => a.id);
  } else {
    // Favorites land first, then sort_order within each group. Backed by
    // the `(category_id, is_favorite desc, sort_order asc)` index added in
    // migration 0015.
    const { data: rows } = await supabase
      .from("artifact_categories")
      .select("artifact_id, sort_order, is_favorite")
      .eq("category_id", categoryId)
      .order("is_favorite", { ascending: false })
      .order("sort_order", { ascending: true });
    scopedArtifactIds = (rows ?? []).map((r) => r.artifact_id);
  }

  // Always load all categories — the sticky drag-bar needs them all,
  // even when the current drill-down is empty.
  const allCategoriesPromise = supabase
    .from("categories")
    .select("id, name")
    .eq("board_id", boardId)
    .order("sort_order")
    .order("name");

  if (scopedArtifactIds.length === 0) {
    const { data: allCategories } = await allCategoriesPromise;
    return {
      category,
      artifacts: [],
      membershipsByArtifact: {},
      tagsByArtifact: {},
      allTags: [],
      allCategories: allCategories ?? [],
      provenanceByArtifact: {},
      signedImageUrls: {},
    };
  }

  // Step 2: load full rows for the scoped artifacts plus everything the
  // ArtifactCard panels need (memberships, tags, provenance).
  const [
    { data: artifactRows },
    { data: membershipRows },
    { data: artifactTagRows },
    { data: tagRows },
    { data: allCategoriesData },
    { data: propertyLinkRows },
  ] = await Promise.all([
    supabase
      .from("artifacts")
      .select(
        "id, board_id, kind, storage_path, url, body, metadata, created_at",
      )
      .in("id", scopedArtifactIds),
    supabase
      .from("artifact_categories")
      .select("artifact_id, category_id, sort_order, is_favorite")
      .in("artifact_id", scopedArtifactIds),
    supabase
      .from("artifact_tags")
      .select("artifact_id, tag_id")
      .in("artifact_id", scopedArtifactIds),
    supabase.from("tags").select("id, name").eq("board_id", boardId),
    allCategoriesPromise,
    supabase
      .from("property_artifacts")
      .select(
        "artifact_id, properties!inner(address, city, state, source_url)",
      )
      .in("artifact_id", scopedArtifactIds),
  ]);

  // Preserve the scoped order (sort_order asc for real categories,
  // created_at desc for uncategorized).
  const rowById = new Map(
    (artifactRows ?? []).map((r) => [r.id, r as ArtifactRow]),
  );
  const artifacts: Artifact[] = scopedArtifactIds
    .map((id) => rowById.get(id))
    .filter((r): r is ArtifactRow => !!r)
    .map(toArtifact);

  const membershipsByArtifact: Record<
    string,
    { categoryId: string; sortOrder: number; isFavorite: boolean }[]
  > = {};
  for (const m of membershipRows ?? []) {
    const list = membershipsByArtifact[m.artifact_id] ?? [];
    list.push({
      categoryId: m.category_id,
      sortOrder: m.sort_order,
      isFavorite: !!m.is_favorite,
    });
    membershipsByArtifact[m.artifact_id] = list;
  }

  const tagsById = new Map((tagRows ?? []).map((t) => [t.id, t.name]));
  const tagsByArtifact: Record<string, { id: string; name: string }[]> = {};
  for (const at of artifactTagRows ?? []) {
    const name = tagsById.get(at.tag_id);
    if (!name) continue;
    const list = tagsByArtifact[at.artifact_id] ?? [];
    list.push({ id: at.tag_id, name });
    tagsByArtifact[at.artifact_id] = list;
  }

  const provenanceByArtifact: Record<string, ArtifactProvenance> = {};
  for (const row of propertyLinkRows ?? []) {
    const join = (
      row as unknown as {
        properties:
          | {
              address: string | null;
              city: string | null;
              state: string | null;
              source_url: string;
            }
          | {
              address: string | null;
              city: string | null;
              state: string | null;
              source_url: string;
            }[];
      }
    ).properties;
    const property = Array.isArray(join) ? join[0] : join;
    if (!property) continue;
    provenanceByArtifact[row.artifact_id] = {
      address: property.address,
      city: property.city,
      state: property.state,
      sourceUrl: property.source_url,
    };
  }

  const imagePaths: string[] = [];
  for (const a of artifacts) {
    if (a.kind === "image" && a.storagePath) imagePaths.push(a.storagePath);
  }
  const signedImageUrls = await signImagePaths(imagePaths);

  return {
    category,
    artifacts,
    membershipsByArtifact,
    tagsByArtifact,
    allTags: tagRows ?? [],
    allCategories: allCategoriesData ?? [],
    provenanceByArtifact,
    signedImageUrls,
  };
}

// ---------------------------------------------------------------------------
// Canvas mode positions — per-category freeform x/y for cards
// ---------------------------------------------------------------------------

const CANVAS_COLS = 4;

/**
 * Loads (and lazily seeds) canvas positions for every artifact in a
 * category. Returns a map of `artifactId -> {x, y}` covering every row
 * for the category, including ones that just got seeded in-memory for
 * read-only viewers.
 *
 * Seeding rule: any row whose `canvas_x` is null gets placed in a
 * 4-wide grid driven by `sort_order`. If the viewer can edit, the
 * seeded values are persisted (idempotent — only fills nulls). If they
 * can't, the seeds live only in this response so the canvas still
 * renders sanely.
 *
 * Uncategorized has no rows in `artifact_categories`, so this function
 * returns an empty map for `categoryId === UNCATEGORIZED_ID`. Canvas
 * mode is unsupported there.
 */
export async function loadCanvasPositions(
  supabase: ServerClient,
  boardId: string,
  categoryId: string,
  canEdit: boolean,
): Promise<Record<string, CanvasPosition>> {
  if (categoryId === UNCATEGORIZED_ID) return {};

  const { data: rows } = await supabase
    .from("artifact_categories")
    .select(
      "artifact_id, canvas_x, canvas_y, sort_order, artifacts!inner(board_id)",
    )
    .eq("category_id", categoryId)
    .eq("artifacts.board_id", boardId);

  const positions: Record<string, CanvasPosition> = {};
  const toSeed: { artifactId: string; sortOrder: number }[] = [];

  for (const r of rows ?? []) {
    if (r.canvas_x !== null && r.canvas_y !== null) {
      positions[r.artifact_id] = { x: r.canvas_x, y: r.canvas_y };
    } else {
      toSeed.push({
        artifactId: r.artifact_id,
        sortOrder: r.sort_order ?? 0,
      });
    }
  }

  if (toSeed.length === 0) return positions;

  // Compute seed positions in a 4-wide grid driven by sort_order.
  const seeds = toSeed.map((s) => {
    const col = s.sortOrder % CANVAS_COLS;
    const row = Math.floor(s.sortOrder / CANVAS_COLS);
    return {
      artifactId: s.artifactId,
      x: col * (CANVAS_CARD_W + CANVAS_GAP),
      y: row * (CANVAS_CARD_H + CANVAS_GAP),
    };
  });

  for (const s of seeds) {
    positions[s.artifactId] = { x: s.x, y: s.y };
  }

  // Persist only if the viewer can edit. RLS still gates per row, so
  // this is the same authorization boundary as a manual drag.
  if (canEdit) {
    await Promise.all(
      seeds.map((s) =>
        supabase
          .from("artifact_categories")
          .update({ canvas_x: s.x, canvas_y: s.y })
          .eq("artifact_id", s.artifactId)
          .eq("category_id", categoryId),
      ),
    );
  }

  return positions;
}

// ---------------------------------------------------------------------------
// Storage URL signing — shared admin-client wrapper
// ---------------------------------------------------------------------------

/**
 * Always go through the admin client so anonymous viewers of public
 * boards can load images — the storage bucket's RLS policies are
 * authenticated-only, but signed URLs bypass them.
 *
 * The caller is responsible for only passing in paths the viewer is
 * allowed to see (already filtered via the user-scoped client's RLS).
 */
export async function signImagePaths(
  paths: string[],
): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const admin = createAdminClient();
  const { data: signed } = await admin.storage
    .from("artifacts")
    .createSignedUrls(paths, 3600);
  const out: Record<string, string> = {};
  for (const item of signed ?? []) {
    if (item.path && item.signedUrl) {
      out[item.path] = item.signedUrl;
    }
  }
  return out;
}
