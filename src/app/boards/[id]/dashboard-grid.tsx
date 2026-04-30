import type { DashboardSummary } from "@/lib/board-data";

import { CategoryTile } from "./category-tile";

const SERIF =
  '"Cochin", "Hoefler Text", "Iowan Old Style", "Palatino Linotype", Georgia, serif';

export function DashboardGrid({
  boardId,
  summary,
  signedThumbUrls,
  canEdit,
}: {
  boardId: string;
  summary: DashboardSummary;
  signedThumbUrls: Record<string, string>;
  canEdit: boolean;
}) {
  if (summary.tiles.length === 0) {
    return <EmptyState canEdit={canEdit} />;
  }

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {summary.tiles.map((tile) => (
        <CategoryTile
          key={tile.id}
          boardId={boardId}
          tile={tile}
          signedThumbUrls={signedThumbUrls}
        />
      ))}
    </div>
  );
}

function EmptyState({ canEdit }: { canEdit: boolean }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-8 py-16 text-center">
      <svg
        width="96"
        height="96"
        viewBox="0 0 96 96"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-stone-400"
        aria-hidden="true"
      >
        <path d="M14 52 L48 22 L82 52" />
        <path d="M22 47 V78 H74 V47" />
        <path d="M40 78 V62 H56 V78" />
        <circle cx="62" cy="58" r="1.5" fill="currentColor" stroke="none" />
      </svg>
      <p
        style={{ fontFamily: SERIF }}
        className="text-xl italic leading-relaxed text-stone-500"
      >
        Your board is blank.
        <br />
        {canEdit
          ? "Drop in a photo, a listing link, or just a thought."
          : "Nothing pinned here yet."}
      </p>
    </div>
  );
}
