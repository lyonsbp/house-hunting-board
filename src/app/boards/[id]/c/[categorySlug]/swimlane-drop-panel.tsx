"use client";

import { useDroppable } from "@dnd-kit/core";

import { UNCATEGORIZED_ID } from "@/lib/board-data-shared";

const SERIF =
  '"Cochin", "Hoefler Text", "Iowan Old Style", "Palatino Linotype", Georgia, serif';

/**
 * Swimlane data for the panel — a slim row per category. Mirrors the
 * dashboard's `CategoryTile` shape minus the type import (which would
 * pull in server-only code into this client module).
 */
export type SwimlaneTile = {
  id: string;
  name: string;
  count: number;
  thumbnailPaths: string[];
};

/**
 * Slide-up panel that appears at the bottom of the drill-down view
 * during a drag. Each row is a `useDroppable` so the existing
 * `chip:assign:<id>` / `chip:unassign` dispatcher in `<CategoryView>`
 * keeps working unchanged.
 *
 * Categories shown: every board category EXCEPT the current one and
 * Uncategorized (Uncategorized is reachable via the "Remove from
 * category" row, which renders only when the current view IS a real
 * category).
 */
export function SwimlaneDropPanel({
  currentCategoryId,
  otherTiles,
  signedThumbUrls,
  dragInProgress,
  canEdit,
}: {
  currentCategoryId: string;
  otherTiles: SwimlaneTile[];
  signedThumbUrls: Record<string, string>;
  dragInProgress: boolean;
  canEdit: boolean;
}) {
  if (!canEdit) return null;

  const showUnassign = currentCategoryId !== UNCATEGORIZED_ID;
  const isEmpty = otherTiles.length === 0 && !showUnassign;

  return (
    <div
      aria-hidden={!dragInProgress}
      className={`pointer-events-none fixed inset-x-0 bottom-0 z-40 transition-transform duration-200 ease-out ${
        dragInProgress ? "translate-y-0" : "translate-y-full"
      }`}
    >
      <div className="pointer-events-auto mx-auto max-w-6xl border-t-4 border-amber-200 bg-white shadow-[0_-12px_32px_-8px_rgba(0,0,0,0.25)]">
        <div
          className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-[0.18em] text-stone-500"
          style={{ letterSpacing: "0.18em" }}
        >
          Drop on a category to move
        </div>
        <div className="max-h-[55vh] overflow-y-auto px-3 pb-4 pt-2">
          {isEmpty ? (
            <p
              className="py-6 text-center text-sm italic text-stone-400"
              style={{ fontFamily: SERIF }}
            >
              No other categories yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {otherTiles.map((t) => (
                <SwimlaneRow
                  key={t.id}
                  tile={t}
                  signedThumbUrls={signedThumbUrls}
                  disabled={!dragInProgress}
                />
              ))}
              {showUnassign && <UnassignRow disabled={!dragInProgress} />}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function SwimlaneRow({
  tile,
  signedThumbUrls,
  disabled,
}: {
  tile: SwimlaneTile;
  signedThumbUrls: Record<string, string>;
  disabled: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `chip:assign:${tile.id}`,
    disabled,
  });
  const thumbs = tile.thumbnailPaths
    .map((p) => signedThumbUrls[p])
    .filter((u): u is string => !!u)
    .slice(0, 4);

  return (
    <li
      ref={setNodeRef}
      className={`flex items-center gap-3 rounded-lg border-2 px-3 py-3 transition-colors sm:gap-4 sm:px-4 ${
        isOver
          ? "border-amber-400 bg-amber-50"
          : "border-stone-200 bg-stone-50/60"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <h3
            className="truncate text-lg font-normal text-stone-900"
            style={{ fontFamily: SERIF }}
          >
            {tile.name}
          </h3>
          <span className="shrink-0 text-[10px] uppercase tracking-[0.18em] text-stone-400">
            {tile.count} {tile.count === 1 ? "item" : "items"}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {thumbs.length > 0 ? (
          thumbs.map((url, i) => (
            <div
              key={i}
              className="h-11 w-11 overflow-hidden rounded border border-white bg-stone-200 shadow-sm sm:h-12 sm:w-12"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
          ))
        ) : (
          <span
            className="px-2 text-[11px] italic text-stone-400"
            style={{ fontFamily: SERIF }}
          >
            no images
          </span>
        )}
      </div>
      <div
        aria-hidden
        className={`text-xl transition-colors ${
          isOver ? "text-amber-700" : "text-stone-300"
        }`}
      >
        →
      </div>
    </li>
  );
}

function UnassignRow({ disabled }: { disabled: boolean }) {
  const { setNodeRef, isOver } = useDroppable({
    id: "chip:unassign",
    disabled,
  });
  return (
    <li
      ref={setNodeRef}
      className={`flex items-center gap-3 rounded-lg border-2 px-3 py-3 transition-colors sm:gap-4 sm:px-4 ${
        isOver
          ? "border-stone-700 bg-stone-200"
          : "border-stone-200 bg-white"
      }`}
    >
      <div className="flex-1">
        <p
          className="text-sm italic text-stone-600"
          style={{ fontFamily: SERIF }}
        >
          Remove from category
        </p>
      </div>
      <div
        aria-hidden
        className={`text-xl transition-colors ${
          isOver ? "text-stone-800" : "text-stone-300"
        }`}
      >
        ×
      </div>
    </li>
  );
}
