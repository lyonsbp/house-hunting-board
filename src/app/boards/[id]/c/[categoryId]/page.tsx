import { notFound } from "next/navigation";
import Link from "next/link";

import {
  loadBoardCore,
  loadCategoryDrillDown,
  UNCATEGORIZED_ID,
} from "@/lib/board-data";
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
  params: Promise<{ id: string; categoryId: string }>;
}) {
  const { id, categoryId } = await params;
  const supabase = await createClient();

  const core = await loadBoardCore(supabase, id);
  if (!core) notFound();

  const drill = await loadCategoryDrillDown(supabase, id, categoryId);
  if (!drill) notFound();

  const displayName = drill.category?.name ?? "Uncategorized";
  const isUncategorized = categoryId === UNCATEGORIZED_ID;

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
        categoryId={categoryId}
        categoryName={displayName}
        artifacts={drill.artifacts}
        signedImageUrls={drill.signedImageUrls}
        membershipsByArtifact={drill.membershipsByArtifact}
        tagsByArtifact={drill.tagsByArtifact}
        allTags={drill.allTags}
        allCategories={drill.allCategories}
        provenanceByArtifact={drill.provenanceByArtifact}
        canEdit={core.canEdit}
      />

      {core.canEdit && <PasteImageListener boardId={id} />}
      <RealtimeBridge boardId={id} />
    </main>
  );
}
