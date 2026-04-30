"use client";

import { useDroppable } from "@dnd-kit/core";

import { UNCATEGORIZED_ID } from "@/lib/board-data-shared";

const SERIF =
  '"Cochin", "Hoefler Text", "Iowan Old Style", "Palatino Linotype", Georgia, serif';

/**
 * Slide-down chip bar that appears at the top of the viewport during a
 * cross-category drag inside a drill-down view. Each chip is a
 * `useDroppable`. Drops are interpreted by `<CategoryView>`'s
 * `onDragEnd` based on the chip id (`chip:assign:<id>` or
 * `chip:unassign`).
 *
 * Hidden entirely for read-only viewers (no `canEdit` ⇒ no drag ⇒ no
 * need for drop targets).
 */
export function StickyDragBar({
  currentCategoryId,
  allCategories,
  dragInProgress,
  canEdit,
}: {
  currentCategoryId: string;
  allCategories: { id: string; name: string }[];
  dragInProgress: boolean;
  canEdit: boolean;
}) {
  if (!canEdit) return null;

  const otherCategories = allCategories.filter(
    (c) => c.id !== currentCategoryId,
  );
  const showUnassign = currentCategoryId !== UNCATEGORIZED_ID;
  const hasNoTargets = otherCategories.length === 0 && !showUnassign;

  return (
    <div
      aria-hidden={!dragInProgress}
      className={`pointer-events-none fixed inset-x-0 top-0 z-50 transition-transform duration-150 ease-out ${
        dragInProgress ? "translate-y-0" : "-translate-y-full"
      }`}
    >
      <div
        className={`pointer-events-auto border-b border-stone-200 bg-white/95 shadow-md backdrop-blur-sm`}
      >
        <div className="mx-auto flex max-w-6xl items-center gap-2 overflow-x-auto px-4 py-3">
          <span
            className="shrink-0 text-[11px] uppercase tracking-[0.18em] text-stone-400"
            style={{ letterSpacing: "0.18em" }}
          >
            Drop on:
          </span>
          {showUnassign && <UnassignChip disabled={!dragInProgress} />}
          {otherCategories.map((c) => (
            <AssignChip
              key={c.id}
              categoryId={c.id}
              name={c.name}
              disabled={!dragInProgress}
            />
          ))}
          {hasNoTargets && (
            <span
              className="text-sm italic text-stone-400"
              style={{ fontFamily: SERIF }}
            >
              No other categories yet.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function AssignChip({
  categoryId,
  name,
  disabled,
}: {
  categoryId: string;
  name: string;
  disabled: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `chip:assign:${categoryId}`,
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      className={`shrink-0 select-none rounded-full border px-4 py-1.5 text-sm transition-colors ${
        isOver
          ? "border-amber-400 bg-amber-100 text-stone-900"
          : "border-stone-300 bg-white text-stone-700"
      }`}
    >
      {name}
    </div>
  );
}

function UnassignChip({ disabled }: { disabled: boolean }) {
  const { setNodeRef, isOver } = useDroppable({
    id: "chip:unassign",
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      className={`shrink-0 select-none rounded-full border px-4 py-1.5 text-sm italic transition-colors ${
        isOver
          ? "border-stone-700 bg-stone-200 text-stone-900"
          : "border-stone-300 bg-white text-stone-500"
      }`}
    >
      Remove from category
    </div>
  );
}
