"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";

import type { Artifact } from "@/lib/artifacts";
import {
  CANVAS_CARD_H,
  CANVAS_CARD_W,
  type CanvasPosition,
} from "@/lib/board-data-shared";

import { ArtifactCard } from "../../artifact-card";
import { resetCanvasLayout, setCardPosition } from "./canvas-actions";
import { DragDebugOverlay } from "./drag-debug-overlay";

const SERIF =
  '"Cochin", "Hoefler Text", "Iowan Old Style", "Palatino Linotype", Georgia, serif';

type Tag = { id: string; name: string };
type Category = { id: string; name: string };
type Membership = {
  categoryId: string;
  sortOrder: number;
  isFavorite: boolean;
};
type ArtifactProvenance = {
  address: string | null;
  city: string | null;
  state: string | null;
  sourceUrl: string;
};

/** Pad the auto-grown canvas so cards near the edge still have buffer. */
const CANVAS_EDGE_PADDING = 240;
const CANVAS_MIN_W = 4000;
const CANVAS_MIN_H = 3000;

/**
 * Freeform pin-board view. Cards are absolute-positioned on a large
 * scrollable surface; users drag them to reposition. Drag uses
 * `useDraggable` (no sortable behavior — there's no implicit order
 * here). Pan is the browser's native scroll on the outer container.
 *
 * Why no `<DragOverlay>`: with absolute positioning we can move the
 * original element via dnd-kit's `transform` + `translate3d` directly.
 * After drop, we update local state and the position becomes permanent
 * (no portaled clone needed).
 */
export function CanvasView({
  boardId,
  categoryId,
  artifacts,
  signedImageUrls,
  membershipsByArtifact,
  tagsByArtifact,
  allTags,
  allCategories,
  provenanceByArtifact,
  canEdit,
  initialPositions,
  showDebug = false,
}: {
  boardId: string;
  categoryId: string;
  artifacts: Artifact[];
  signedImageUrls: Record<string, string>;
  membershipsByArtifact: Record<string, Membership[]>;
  tagsByArtifact: Record<string, Tag[]>;
  allTags: Tag[];
  allCategories: Category[];
  provenanceByArtifact: Record<string, ArtifactProvenance>;
  canEdit: boolean;
  initialPositions: Record<string, CanvasPosition>;
  showDebug?: boolean;
}) {
  const router = useRouter();
  const [positions, setPositions] =
    useState<Record<string, CanvasPosition>>(initialPositions);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
  );

  function handleDragEnd(e: DragEndEvent) {
    if (!canEdit) return;
    const id = String(e.active.id);
    const cur = positions[id] ?? { x: 0, y: 0 };
    const next = { x: cur.x + e.delta.x, y: cur.y + e.delta.y };
    setPositions((p) => ({ ...p, [id]: next }));
    void setCardPosition({
      boardId,
      categoryId,
      artifactId: id,
      x: next.x,
      y: next.y,
    })
      .then((res) => {
        if ("error" in res) {
          // Roll back on server-side error.
          setPositions((p) => ({ ...p, [id]: cur }));
        }
        router.refresh();
      })
      .catch(() => {
        setPositions((p) => ({ ...p, [id]: cur }));
      });
  }

  // Auto-grow canvas to cover whatever positions we currently have, so
  // dragging a card past the edge doesn't clip it.
  let canvasW = CANVAS_MIN_W;
  let canvasH = CANVAS_MIN_H;
  for (const id of Object.keys(positions)) {
    const p = positions[id];
    canvasW = Math.max(canvasW, p.x + CANVAS_CARD_W + CANVAS_EDGE_PADDING);
    canvasH = Math.max(canvasH, p.y + CANVAS_CARD_H + CANVAS_EDGE_PADDING);
  }

  function handleReset() {
    if (!canEdit) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Reset canvas? This re-aligns every card to a tidy grid and undoes any custom positioning.",
      )
    ) {
      return;
    }
    void resetCanvasLayout({ boardId, categoryId })
      .then((res) => {
        if ("ok" in res) {
          setPositions(res.positions);
        }
        router.refresh();
      })
      .catch(() => router.refresh());
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      {canEdit && (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleReset}
            className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 transition-colors hover:bg-stone-50"
            style={{ fontFamily: SERIF }}
            title="Re-align all cards into a tidy grid"
          >
            Reset layout
          </button>
        </div>
      )}
      <div
        className="relative overflow-auto rounded-lg border border-stone-200 bg-[#faf8f4]"
        // resize: vertical lets the user drag the bottom-right corner to
        // make the canvas viewport taller. min-h gives a usable default;
        // initial height set via inline style so the user's resize sticks
        // (Tailwind's h-[75vh] would override).
        style={{ resize: "vertical", height: "75vh", minHeight: "320px" }}
      >
        <div
          className="relative"
          style={{
            width: canvasW,
            height: canvasH,
            backgroundImage:
              "radial-gradient(circle, rgba(120, 113, 108, 0.18) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        >
          {artifacts.map((art) => {
            const pos = positions[art.id] ?? { x: 0, y: 0 };
            const memberships = membershipsByArtifact[art.id] ?? [];
            const isFavorite = !!memberships.find(
              (m) => m.categoryId === categoryId,
            )?.isFavorite;
            return (
              <DraggableCanvasCard
                key={art.id}
                artifact={art}
                x={pos.x}
                y={pos.y}
                canEdit={canEdit}
                boardId={boardId}
                categories={allCategories}
                memberCategoryIds={memberships.map((m) => m.categoryId)}
                signedImageUrl={
                  art.kind === "image"
                    ? signedImageUrls[art.storagePath]
                    : undefined
                }
                tags={tagsByArtifact[art.id] ?? []}
                allTags={allTags}
                provenance={provenanceByArtifact[art.id]}
                currentCategoryId={categoryId}
                isFavorite={isFavorite}
              />
            );
          })}
        </div>
      </div>
      {showDebug && <DragDebugOverlay />}
    </DndContext>
  );
}

function DraggableCanvasCard({
  artifact,
  x,
  y,
  canEdit,
  boardId,
  categories,
  memberCategoryIds,
  signedImageUrl,
  tags,
  allTags,
  provenance,
  currentCategoryId,
  isFavorite,
}: {
  artifact: Artifact;
  x: number;
  y: number;
  canEdit: boolean;
  boardId: string;
  categories: Category[];
  memberCategoryIds: string[];
  signedImageUrl?: string;
  tags: Tag[];
  allTags: Tag[];
  provenance?: ArtifactProvenance;
  currentCategoryId: string;
  isFavorite: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: artifact.id,
      disabled: !canEdit,
    });

  const dragProps = canEdit ? { ...attributes, ...listeners } : {};

  // Click-after-drag guard. The browser fires a click on the underlying
  // <a target="_blank"> in listing/link cards once a drag ends — without
  // this guard, every drop opens a new tab. Track the dragging→idle
  // transition (not just mount) and swallow clicks that fire within a
  // short window after a real drag.
  const wasDraggingRef = useRef(false);
  const recentDragEndRef = useRef<number>(0);
  useEffect(() => {
    if (wasDraggingRef.current && !isDragging) {
      recentDragEndRef.current = Date.now();
    }
    wasDraggingRef.current = isDragging;
  }, [isDragging]);

  function handleClickCapture(e: React.MouseEvent) {
    if (Date.now() - recentDragEndRef.current < 300) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: CANVAS_CARD_W,
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
        zIndex: isDragging ? 1000 : 1,
        cursor: canEdit ? (isDragging ? "grabbing" : "grab") : "default",
        // Soft drop-shadow that lifts on drag — visual cue that the
        // card is "picked up" without resorting to a DragOverlay clone.
        filter: isDragging
          ? "drop-shadow(0 16px 24px rgba(0, 0, 0, 0.25))"
          : "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.06))",
      }}
      onClickCapture={handleClickCapture}
      {...dragProps}
    >
      <ArtifactCard
        artifact={artifact}
        boardId={boardId}
        categories={categories}
        memberCategoryIds={memberCategoryIds}
        signedImageUrl={signedImageUrl}
        tags={tags}
        allTags={allTags}
        provenance={provenance}
        canEdit={canEdit}
        currentCategoryId={currentCategoryId}
        isFavorite={isFavorite}
      />
    </div>
  );
}
