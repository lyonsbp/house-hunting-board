"use client";

import { useEffect, useState } from "react";
import { useDraggable } from "@dnd-kit/core";

import {
  listBoardImageArtifactsForRefs,
  type BoardRefArtifact,
} from "./ai-ref-actions";

/**
 * Side panel anchored to the AI edit modal that lists every image
 * artifact on the current board. Each tile is both:
 *   - draggable into a `RefSlot` (matches the PRD wording "drag a thumb
 *     out of the picker into a slot")
 *   - clickable, in which case the parent fills the next empty slot —
 *     a keyboard / touch fallback we adopted in lieu of drag-only.
 *
 * Lazily loads via `listBoardImageArtifactsForRefs` when the panel opens
 * so we don't pay the signed-URL cost on every board page load.
 */
export function BoardRefPicker({
  boardId,
  open,
  onClose,
  onPick,
  excludeArtifactId,
}: {
  boardId: string;
  open: boolean;
  onClose: () => void;
  /** Click-to-fill: caller decides which slot to put it in. */
  onPick: (artifact: BoardRefArtifact) => void;
  /** The parent artifact being edited — hide it from the picker so the
   * user doesn't accidentally reference the very image they're editing. */
  excludeArtifactId: string;
}) {
  const [artifacts, setArtifacts] = useState<BoardRefArtifact[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // The pre-load reset clears stale results when boardId/open change so
    // the user doesn't see another board's thumbs flash through.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setArtifacts(null);
    setError(null);
    listBoardImageArtifactsForRefs(boardId)
      .then((res) => {
        if (cancelled) return;
        if ("error" in res) setError(res.error);
        else setArtifacts(res.artifacts.filter((a) => a.id !== excludeArtifactId));
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Couldn't load board images");
      });
    return () => {
      cancelled = true;
    };
  }, [boardId, open, excludeArtifactId]);

  if (!open) return null;

  return (
    <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-stone-500">
          Board images — drag or click to attach
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-stone-500 hover:text-stone-900"
        >
          Hide
        </button>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
      {!error && artifacts === null && (
        <p className="text-xs text-stone-500">Loading…</p>
      )}
      {!error && artifacts && artifacts.length === 0 && (
        <p className="text-xs text-stone-500">
          No other image artifacts on this board yet.
        </p>
      )}
      {!error && artifacts && artifacts.length > 0 && (
        <div className="grid max-h-[40dvh] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
          {artifacts.map((a) => (
            <PickerTile key={a.id} artifact={a} onClick={() => onPick(a)} />
          ))}
        </div>
      )}
    </div>
  );
}

function PickerTile({
  artifact,
  onClick,
}: {
  artifact: BoardRefArtifact;
  onClick: () => void;
}) {
  // Draggable into a `RefSlot` (which is a useDroppable target).
  const { attributes, listeners, setNodeRef, isDragging, transform } =
    useDraggable({
      id: `picker-${artifact.id}`,
      data: { kind: "board-ref", artifact },
    });

  const style: React.CSSProperties = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: 50,
        opacity: isDragging ? 0.85 : 1,
      }
    : { opacity: isDragging ? 0.4 : 1 };

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      style={style}
      {...attributes}
      {...listeners}
      title={artifact.label ?? undefined}
      className="aspect-square overflow-hidden rounded-md border border-stone-200 bg-white text-left transition-colors hover:border-stone-500"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={artifact.signedUrl}
        alt={artifact.label ?? "Board image"}
        className="h-full w-full object-cover"
        draggable={false}
      />
    </button>
  );
}
