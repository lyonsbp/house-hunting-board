import { notFound } from "next/navigation";
import Link from "next/link";

import {
  loadBoardCore,
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
import { CategoryView } from "./category-view";

const SERIF =
  '"Cochin", "Hoefler Text", "Iowan Old Style", "Palatino Linotype", Georgia, serif';

export default async function CategoryDrillDownPage({
  params,
}: {
  params: Promise<{ id: string; categorySlug: string }>;
}) {
  const { id, categorySlug } = await params;
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

  const [drill, dashboardSummary] = await Promise.all([
    loadCategoryDrillDown(supabase, id, resolvedCategoryId),
    loadDashboardSummary(supabase, id),
  ]);
  if (!drill) notFound();

  const displayName = drill.category?.name ?? "Uncategorized";

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
        <h1
          style={{ fontFamily: SERIF }}
          className={`text-3xl font-normal leading-tight sm:text-4xl ${
            isUncategorized ? "italic text-stone-700" : "text-stone-900"
          }`}
        >
          {displayName}
        </h1>
      </header>

      {!core.canEdit && <ReadOnlyBanner signedIn={!!core.userId} />}

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
      />

      {core.canEdit && <PasteImageListener boardId={id} />}
      <RealtimeBridge boardId={id} />
    </main>
  );
}
