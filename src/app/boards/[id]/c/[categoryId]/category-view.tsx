"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
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
import { StickyDragBar } from "./sticky-drag-bar";

const SERIF =
  '"Cochin", "Hoefler Text", "Iowan Old Style", "Palatino Linotype", Georgia, serif';

type Tag = { id: string; name: string };
type Membership = { categoryId: string; sortOrder: number };
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
}) {
  const router = useRouter();
  const [optimistic, setOptimistic] = useState<Artifact[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const artifacts = optimistic ?? initialArtifacts;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
  );

  // pointerWithin gives precise drops on chips/cards under the cursor;
  // rectIntersection backstops when the pointer leaves all droppables.
  const collisionDetection: CollisionDetection = (args) => {
    const pointer = pointerWithin(args);
    if (pointer.length > 0) return pointer;
    return rectIntersection(args);
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
    >
      <StickyDragBar
        currentCategoryId={categoryId}
        allCategories={allCategories}
        dragInProgress={activeId !== null}
        canEdit={canEdit}
      />

      <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-2 gap-5 md:grid-cols-3 md:gap-6 lg:grid-cols-4">
          {artifacts.map((art) => (
            <SortableCard
              key={art.id}
              artifact={art}
              boardId={boardId}
              categories={allCategories}
              memberCategoryIds={(membershipsByArtifact[art.id] ?? []).map(
                (m) => m.categoryId,
              )}
              signedImageUrl={
                art.kind === "image" ? signedImageUrls[art.storagePath] : undefined
              }
              tags={tagsByArtifact[art.id] ?? []}
              allTags={allTags}
              provenance={provenanceByArtifact[art.id]}
              canEdit={canEdit}
            />
          ))}
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
            />
          </div>
        ) : null}
      </DragOverlay>
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
