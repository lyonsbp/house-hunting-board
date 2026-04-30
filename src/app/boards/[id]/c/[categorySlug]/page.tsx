import { notFound } from "next/navigation";
import Link from "next/link";

import {
  loadBoardCore,
  loadCanvasPositions,
  loadCategoryDrillDown,
  loadDashboardSummary,
  signImagePaths,
  UNCATEGORIZED_ID,
} from "@/lib/board-data";
import { findCategoryBySlug } from "@/lib/slug";
import { createClient } from "@/lib/supabase/server";

import { PasteImageListener } from "../../paste-image-listener";
import { ReadOnlyBanner } from "../../read-only-banner";
import { RealtimeBridge } from "../../realtime-bridge";
import { CanvasView } from "./canvas-view";
import { CategoryView } from "./category-view";
import { ModeToggle, type ViewMode } from "./mode-toggle";

const SERIF =
  '"Cochin", "Hoefler Text", "Iowan Old Style", "Palatino Linotype", Georgia, serif';

export default async function CategoryDrillDownPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; categorySlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id, categorySlug } = await params;
  const sp = await searchParams;
  const supabase = await createClient();

  const core = await loadBoardCore(supabase, id);
  if (!core) notFound();

  // Resolve the URL slug to a real category id (or the Uncategorized
  // sentinel). We fetch the board's categories once and match against
  // computed slugs — keeps slugs out of the DB so a rename takes effect
  // on the next request without a migration.
  const isUncategorized = categorySlug === UNCATEGORIZED_ID;
  let resolvedCategoryId: string;
  if (isUncategorized) {
    resolvedCategoryId = UNCATEGORIZED_ID;
  } else {
    const { data: cats } = await supabase
      .from("categories")
      .select("id, name")
      .eq("board_id", id)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    const found = findCategoryBySlug(cats ?? [], categorySlug);
    if (!found) notFound();
    resolvedCategoryId = found.id;
  }

  // Mode routing: ?mode=canvas flips the drill-down to freeform layout.
  // Canvas is unsupported on Uncategorized (no artifact_categories row to
  // attach a position to) — silently fall back to grid.
  const rawMode = typeof sp.mode === "string" ? sp.mode : undefined;
  const mode: ViewMode =
    rawMode === "canvas" && !isUncategorized ? "canvas" : "grid";

  // ?debug=1 surfaces an on-screen DnD inspector inside whichever
  // DndContext renders below — for diagnosing why a drop isn't landing.
  const showDebug =
    (typeof sp.debug === "string" ? sp.debug : undefined) === "1";

  const [drill, dashboardSummary] = await Promise.all([
    loadCategoryDrillDown(supabase, id, resolvedCategoryId),
    loadDashboardSummary(supabase, id),
  ]);
  if (!drill) notFound();

  const displayName = drill.category?.name ?? "Uncategorized";

  // Canvas-only data: positions for each card, lazy-seeded if missing.
  // Skipped for grid mode and for Uncategorized so we don't write
  // canvas_x/y rows that no view will read.
  const canvasPositions =
    mode === "canvas"
      ? await loadCanvasPositions(
          supabase,
          id,
          resolvedCategoryId,
          core.canEdit,
        )
      : {};

  // Swim-lane panel: every category except the current one and
  // Uncategorized (Uncategorized is reachable via the panel's "Remove
  // from category" row when the current view is a real category).
  const panelTiles = dashboardSummary.tiles.filter(
    (t) => t.id !== resolvedCategoryId && t.id !== UNCATEGORIZED_ID,
  );
  const panelThumbPaths = Array.from(
    new Set(panelTiles.flatMap((t) => t.thumbnailPaths)),
  );
  const panelThumbUrls = await signImagePaths(panelThumbPaths);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:gap-10 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-1">
        <Link
          href={`/boards/${id}`}
          className="text-[11px] uppercase tracking-[0.22em] text-stone-500 transition-colors hover:text-stone-800"
          style={{ letterSpacing: "0.22em" }}
        >
          ← {core.board.name}
        </Link>
        <div className="flex items-center justify-between gap-4">
          <h1
            style={{ fontFamily: SERIF }}
            className={`text-3xl font-normal leading-tight sm:text-4xl ${
              isUncategorized ? "italic text-stone-700" : "text-stone-900"
            }`}
          >
            {displayName}
          </h1>
          {!isUncategorized && <ModeToggle mode={mode} />}
        </div>
      </header>

      {!core.canEdit && <ReadOnlyBanner signedIn={!!core.userId} />}

      {mode === "canvas" ? (
        <CanvasView
          boardId={id}
          categoryId={resolvedCategoryId}
          artifacts={drill.artifacts}
          signedImageUrls={drill.signedImageUrls}
          membershipsByArtifact={drill.membershipsByArtifact}
          tagsByArtifact={drill.tagsByArtifact}
          allTags={drill.allTags}
          allCategories={drill.allCategories}
          provenanceByArtifact={drill.provenanceByArtifact}
          canEdit={core.canEdit}
          initialPositions={canvasPositions}
          showDebug={showDebug}
        />
      ) : (
        <CategoryView
          boardId={id}
          categoryId={resolvedCategoryId}
          categoryName={displayName}
          artifacts={drill.artifacts}
          signedImageUrls={drill.signedImageUrls}
          membershipsByArtifact={drill.membershipsByArtifact}
          tagsByArtifact={drill.tagsByArtifact}
          allTags={drill.allTags}
          allCategories={drill.allCategories}
          provenanceByArtifact={drill.provenanceByArtifact}
          canEdit={core.canEdit}
          panelTiles={panelTiles}
          panelThumbUrls={panelThumbUrls}
          showDebug={showDebug}
        />
      )}

      {core.canEdit && <PasteImageListener boardId={id} />}
      <RealtimeBridge boardId={id} />
    </main>
  );
}
