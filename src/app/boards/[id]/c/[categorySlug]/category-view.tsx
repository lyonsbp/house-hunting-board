"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { Artifact } from "@/lib/artifacts";
import { UNCATEGORIZED_ID } from "@/lib/board-data-shared";

import {
  assignCategory,
  reorderCategory,
  unassignCategory,
} from "../../actions";
import { ArtifactCard } from "../../artifact-card";
import { DragDebugOverlay } from "./drag-debug-overlay";
import { NewCategoryDialog } from "./new-category-dialog";
import {
  SwimlaneDropPanel,
  type SwimlaneTile,
} from "./swimlane-drop-panel";

const SERIF =
  '"Cochin", "Hoefler Text", "Iowan Old Style", "Palatino Linotype", Georgia, serif';

type Tag = { id: string; name: string };
type Membership = {
  categoryId: string;
  sortOrder: number;
  isFavorite: boolean;
};
type Category = { id: string; name: string };
type ArtifactProvenance = {
  address: string | null;
  city: string | null;
  state: string | null;
  sourceUrl: string;
};

export function CategoryView({
  boardId,
  categoryId,
  categoryName,
  artifacts: initialArtifacts,
  signedImageUrls,
  membershipsByArtifact,
  tagsByArtifact,
  allTags,
  allCategories,
  provenanceByArtifact,
  canEdit,
  panelTiles,
  panelThumbUrls,
  showDebug = false,
}: {
  boardId: string;
  /** Category UUID, or UNCATEGORIZED_ID for the sentinel view. */
  categoryId: string;
  categoryName: string;
  artifacts: Artifact[];
  signedImageUrls: Record<string, string>;
  membershipsByArtifact: Record<string, Membership[]>;
  tagsByArtifact: Record<string, Tag[]>;
  allTags: Tag[];
  allCategories: Category[];
  provenanceByArtifact: Record<string, ArtifactProvenance>;
  canEdit: boolean;
  /**
   * Other categories (excluding current and Uncategorized) — drives the
   * swim-lane drop panel that appears during a drag.
   */
  panelTiles: SwimlaneTile[];
  panelThumbUrls: Record<string, string>;
  /** ?debug=1 turns on the on-screen DnD inspector. */
  showDebug?: boolean;
}) {
  const router = useRouter();
  const [optimistic, setOptimistic] = useState<Artifact[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  /** Set when the user drops on the "+ New category" swim-lane row.
   *  Triggers the name modal; null when the modal is closed. */
  const [pendingNewArtifactId, setPendingNewArtifactId] = useState<
    string | null
  >(null);

  const artifacts = optimistic ?? initialArtifacts;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
  );

  // Cursor-magnet collision strategy.
  //
  // Each chip in the swim-lane panel gets an invisible 200px "magnet
  // zone" extending upward from its top edge. When the cursor enters
  // that zone, the chip activates — even though the cursor isn't yet
  // physically over the row. As the cursor moves further down and
  // crosses into deeper magnet zones, the *lowermost* chip whose zone
  // contains the cursor wins, so the selection progresses naturally
  // (row 1 → row 2 → row 3) as you drag toward the panel.
  //
  // We don't rely on the dragged element's rect because with a
  // <DragOverlay> dnd-kit's collisionRect is the overlay clone (a small
  // rect centered on the cursor), not the source card's full extent
  // translated. The cursor + magnet zones give a deterministic
  // hit-test independent of what dnd-kit thinks the dragged rect is.
  //
  // Cursor on a chip or card always wins over the magnet zone, so
  // precise drops keep working: hover any chip directly to lock onto
  // it; hover a grid card to reorder.
  const collisionDetection: CollisionDetection = (args) => {
    const pointer = pointerWithin(args);
    const pointerChips = pointer.filter((c) =>
      String(c.id).startsWith("chip:"),
    );
    if (pointerChips.length > 0) return pointerChips;
    const pointerCards = pointer.filter(
      (c) => !String(c.id).startsWith("chip:"),
    );
    if (pointerCards.length > 0) return pointerCards;

    const cursor = args.pointerCoordinates;
    if (cursor) {
      const MAGNET_OFFSET_PX = 100;
      const inZone: { id: string | number; top: number }[] = [];
      for (const c of args.droppableContainers) {
        if (c.disabled) continue;
        const id = String(c.id);
        if (!id.startsWith("chip:")) continue;
        const rect = args.droppableRects.get(c.id);
        if (!rect) continue;
        const zoneTop = rect.top - MAGNET_OFFSET_PX;
        const zoneBottom = rect.bottom;
        if (cursor.y >= zoneTop && cursor.y <= zoneBottom) {
          inZone.push({ id: c.id, top: rect.top });
        }
      }
      if (inZone.length > 0) {
        inZone.sort((a, b) => b.top - a.top);
        return [{ id: inZone[0].id }];
      }
    }

    return closestCenter(args);
  };

  const activeArtifact = activeId
    ? (artifacts.find((a) => a.id === activeId) ?? null)
    : null;

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function handleDragCancel() {
    setActiveId(null);
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    if (!canEdit || !e.over) return;
    const activeArtifactId = String(e.active.id);
    const overId = String(e.over.id);

    // Sticky-bar drops first.
    if (overId === "chip:new") {
      // Defer the actual create + assign to the modal — opens with the
      // dropped artifact pre-selected and asks for a name.
      setPendingNewArtifactId(activeArtifactId);
      return;
    }
    if (overId === "chip:unassign") {
      if (categoryId === UNCATEGORIZED_ID) return;
      void unassignCategory({
        artifactId: activeArtifactId,
        categoryId,
        boardId,
      }).finally(() => router.refresh());
      return;
    }
    if (overId.startsWith("chip:assign:")) {
      const dest = overId.slice("chip:assign:".length);
      const ops =
        categoryId === UNCATEGORIZED_ID
          ? [
              assignCategory({
                artifactId: activeArtifactId,
                categoryId: dest,
                boardId,
              }),
            ]
          : [
              unassignCategory({
                artifactId: activeArtifactId,
                categoryId,
                boardId,
              }),
              assignCategory({
                artifactId: activeArtifactId,
                categoryId: dest,
                boardId,
              }),
            ];
      void Promise.all(ops).finally(() => router.refresh());
      return;
    }

    // Same-grid reorder. Uncategorized has no sort_order — skip.
    if (categoryId === UNCATEGORIZED_ID) return;
    if (overId === activeArtifactId) return;

    const oldIdx = artifacts.findIndex((a) => a.id === activeArtifactId);
    const newIdx = artifacts.findIndex((a) => a.id === overId);
    if (oldIdx < 0 || newIdx < 0) return;

    const newOrder = arrayMove(artifacts, oldIdx, newIdx);
    setOptimistic(newOrder);

    void reorderCategory({
      boardId,
      categoryId,
      orderedArtifactIds: newOrder.map((a) => a.id),
    })
      .then(() => {
        setOptimistic(null);
        router.refresh();
      })
      .catch(() => {
        setOptimistic(null);
        router.refresh();
      });
  }

  if (initialArtifacts.length === 0) {
    return <EmptyState canEdit={canEdit} categoryName={categoryName} />;
  }

  const sortableIds = artifacts.map((a) => a.id);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      // Force droppable rect re-measurement every render so the swim-lane
      // panel's chips have correct hit-test bounds during the slide-in
      // animation. Without this, only the rect-stable top row gets hits;
      // the rest stay associated with their off-screen pre-slide positions.
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
    >
      <SwimlaneDropPanel
        currentCategoryId={categoryId}
        otherTiles={panelTiles}
        signedThumbUrls={panelThumbUrls}
        dragInProgress={activeId !== null}
        canEdit={canEdit}
      />

      <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-2 gap-5 md:grid-cols-3 md:gap-6 lg:grid-cols-4">
          {artifacts.map((art) => {
            const memberships = membershipsByArtifact[art.id] ?? [];
            const isFavorite = !!memberships.find(
              (m) => m.categoryId === categoryId,
            )?.isFavorite;
            return (
              <SortableCard
                key={art.id}
                artifact={art}
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
                canEdit={canEdit}
                currentCategoryId={categoryId}
                isFavorite={isFavorite}
              />
            );
          })}
        </div>
      </SortableContext>

      <DragOverlay
        zIndex={1000}
        dropAnimation={{
          duration: 200,
          easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)",
        }}
      >
        {activeArtifact ? (
          <div className="rotate-1 cursor-grabbing opacity-95 shadow-2xl shadow-stone-900/40">
            <ArtifactCard
              artifact={activeArtifact}
              boardId={boardId}
              categories={allCategories}
              memberCategoryIds={(
                membershipsByArtifact[activeArtifact.id] ?? []
              ).map((m) => m.categoryId)}
              signedImageUrl={
                activeArtifact.kind === "image"
                  ? signedImageUrls[activeArtifact.storagePath]
                  : undefined
              }
              tags={tagsByArtifact[activeArtifact.id] ?? []}
              allTags={allTags}
              provenance={provenanceByArtifact[activeArtifact.id]}
              canEdit={false}
              currentCategoryId={categoryId}
              isFavorite={
                !!(membershipsByArtifact[activeArtifact.id] ?? []).find(
                  (m) => m.categoryId === categoryId,
                )?.isFavorite
              }
            />
          </div>
        ) : null}
      </DragOverlay>
      {showDebug && <DragDebugOverlay />}
      {pendingNewArtifactId && (
        <NewCategoryDialog
          boardId={boardId}
          artifactId={pendingNewArtifactId}
          sourceCategoryId={
            categoryId === UNCATEGORIZED_ID ? null : categoryId
          }
          onClose={() => setPendingNewArtifactId(null)}
        />
      )}
    </DndContext>
  );
}

function SortableCard({
  artifact,
  boardId,
  categories,
  signedImageUrl,
  tags,
  memberCategoryIds,
  allTags,
  provenance,
  canEdit,
  currentCategoryId,
  isFavorite,
}: {
  artifact: Artifact;
  boardId: string;
  categories: Category[];
  signedImageUrl?: string;
  tags: Tag[];
  memberCategoryIds: string[];
  allTags: Tag[];
  provenance?: ArtifactProvenance;
  canEdit: boolean;
  currentCategoryId: string;
  isFavorite: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: artifact.id, disabled: !canEdit });

  const dragProps = canEdit ? { ...attributes, ...listeners } : {};

  // While the active item is being dragged, leave its slot empty
  // (opacity 0) and apply no transform — DragOverlay handles the float.
  const style = isDragging
    ? { opacity: 0 }
    : {
        transform: CSS.Transform.toString(transform),
        transition,
      };

  return (
    <div
      ref={setNodeRef}
      suppressHydrationWarning
      style={style}
      {...dragProps}
      className="self-start"
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

function EmptyState({
  canEdit,
  categoryName,
}: {
  canEdit: boolean;
  categoryName: string;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-6 py-20 text-center">
      <p
        style={{ fontFamily: SERIF }}
        className="text-xl italic leading-relaxed text-stone-500"
      >
        {canEdit
          ? `${categoryName} is empty. Drag a card here from another category, or assign one from its menu.`
          : `${categoryName} is empty.`}
      </p>
    </div>
  );
}
