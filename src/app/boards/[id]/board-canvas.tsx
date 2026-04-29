"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
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

import {
  assignCategory,
  reorderCategory,
  unassignCategory,
} from "./actions";
import { ArtifactCard } from "./artifact-card";

const SERIF =
  '"Cochin", "Hoefler Text", "Iowan Old Style", "Palatino Linotype", Georgia, serif';

const UNCATEGORIZED = "uncategorized";

type Category = { id: string; name: string };

type Membership = { categoryId: string; sortOrder: number };

type Tag = { id: string; name: string };

export type ArtifactProvenance = {
  address: string | null;
  city: string | null;
  state: string | null;
  sourceUrl: string;
};

type Lane = {
  id: string;
  name: string;
  artifacts: Artifact[];
};

export function BoardCanvas({
  boardId,
  artifacts,
  signedImageUrls,
  categories,
  membershipsByArtifact,
  tagsByArtifact,
  allTags,
  provenanceByArtifact,
  canEdit,
}: {
  boardId: string;
  artifacts: Artifact[];
  signedImageUrls: Record<string, string>;
  categories: Category[];
  membershipsByArtifact: Record<string, Membership[]>;
  tagsByArtifact: Record<string, Tag[]>;
  allTags: Tag[];
  provenanceByArtifact: Record<string, ArtifactProvenance>;
  canEdit: boolean;
}) {
  const router = useRouter();

  const lanes = useMemo<Lane[]>(() => {
    const byCat = new Map<string, Artifact[]>();
    for (const c of categories) byCat.set(c.id, []);
    const uncategorized: Artifact[] = [];

    for (const art of artifacts) {
      const memberships = membershipsByArtifact[art.id];
      if (!memberships || memberships.length === 0) {
        uncategorized.push(art);
      } else {
        for (const m of memberships) {
          const list = byCat.get(m.categoryId);
          if (list) list.push(art);
        }
      }
    }

    // Sort each category lane by stored sort_order.
    for (const c of categories) {
      const list = byCat.get(c.id) ?? [];
      list.sort((a, b) => {
        const ao =
          membershipsByArtifact[a.id]?.find((m) => m.categoryId === c.id)
            ?.sortOrder ?? 0;
        const bo =
          membershipsByArtifact[b.id]?.find((m) => m.categoryId === c.id)
            ?.sortOrder ?? 0;
        return ao - bo;
      });
    }

    const result: Lane[] = [];
    if (uncategorized.length > 0 || categories.length === 0) {
      result.push({
        id: UNCATEGORIZED,
        name: "Uncategorized",
        artifacts: uncategorized,
      });
    }
    for (const c of categories) {
      result.push({ id: c.id, name: c.name, artifacts: byCat.get(c.id) ?? [] });
    }
    return result;
  }, [artifacts, categories, membershipsByArtifact]);

  const [optimistic, setOptimistic] = useState<Lane[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const displayLanes = optimistic ?? lanes;

  // Split sensors so touch scrolling still works on phones. Mouse drags
  // start after a tiny 6px move (instant feel on desktop); touch drags
  // require a 250ms hold so a regular tap-and-flick scrolls the page
  // instead of grabbing a card.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
  );

  // pointerWithin gives precise drops on cards/lanes the cursor is over;
  // rectIntersection fills in when the pointer leaves all droppables (e.g.
  // dragging fast over the gap between lanes).
  const collisionDetection: CollisionDetection = (args) => {
    const pointer = pointerWithin(args);
    if (pointer.length > 0) return pointer;
    return rectIntersection(args);
  };

  const activeParsed = activeId ? parseSortableId(activeId) : null;
  const activeArtifact = activeParsed
    ? artifacts.find((a) => a.id === activeParsed.artifactId) ?? null
    : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragCancel() {
    setActiveId(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    if (!canEdit) return;
    const { active, over } = event;
    if (!over) return;
    const src = parseSortableId(active.id as string);
    const destLaneId = laneIdOfDropTarget(over.id as string);
    if (!src || !destLaneId) return;

    // Same lane → reorder (only meaningful for category lanes; uncategorized
    // is order-less). If the drop target is the lane itself (not a sibling
    // card), there's nothing to reorder against.
    if (src.laneId === destLaneId) {
      if (src.laneId === UNCATEGORIZED) return;
      const overParsed = parseSortableId(over.id as string);
      if (!overParsed || overParsed.artifactId === src.artifactId) return;

      const lane = displayLanes.find((l) => l.id === src.laneId);
      if (!lane) return;
      const oldIdx = lane.artifacts.findIndex((a) => a.id === src.artifactId);
      const newIdx = lane.artifacts.findIndex(
        (a) => a.id === overParsed.artifactId,
      );
      if (oldIdx < 0 || newIdx < 0) return;
      const newOrder = arrayMove(lane.artifacts, oldIdx, newIdx);

      // Optimistic UI: replace this lane's order.
      setOptimistic(
        displayLanes.map((l) =>
          l.id === src.laneId ? { ...l, artifacts: newOrder } : l,
        ),
      );

      void reorderCategory({
        boardId,
        categoryId: src.laneId,
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
      return;
    }

    // Cross-lane drag. Drop on Uncategorized = remove from the source
    // category (the only meaningful interpretation of "drag back to nothing").
    if (destLaneId === UNCATEGORIZED) {
      if (src.laneId === UNCATEGORIZED) return;
      void unassignCategory({
        artifactId: src.artifactId,
        categoryId: src.laneId,
        boardId,
      }).finally(() => router.refresh());
      return;
    }
    if (src.laneId === UNCATEGORIZED) {
      void assignCategory({
        artifactId: src.artifactId,
        categoryId: destLaneId,
        boardId,
      }).finally(() => router.refresh());
      return;
    }
    // Category → category: move (unassign source, assign dest).
    void Promise.all([
      unassignCategory({
        artifactId: src.artifactId,
        categoryId: src.laneId,
        boardId,
      }),
      assignCategory({
        artifactId: src.artifactId,
        categoryId: destLaneId,
        boardId,
      }),
    ]).finally(() => router.refresh());
  }

  if (artifacts.length === 0) {
    return <EmptyState />;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex flex-col gap-12">
        {displayLanes.map((lane) => (
          <LaneSection
            key={lane.id}
            lane={lane}
            boardId={boardId}
            categories={categories}
            signedImageUrls={signedImageUrls}
            tagsByArtifact={tagsByArtifact}
            membershipsByArtifact={membershipsByArtifact}
            allTags={allTags}
            provenanceByArtifact={provenanceByArtifact}
            canEdit={canEdit}
            sourceLaneId={activeParsed?.laneId ?? null}
          />
        ))}
      </div>
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
              categories={categories}
              memberCategoryIds={
                membershipsByArtifact[activeArtifact.id]?.map(
                  (m) => m.categoryId,
                ) ?? []
              }
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

function parseSortableId(sortableId: string): {
  laneId: string;
  artifactId: string;
} | null {
  const i = sortableId.indexOf("::");
  if (i < 0) return null;
  return {
    laneId: sortableId.slice(0, i),
    artifactId: sortableId.slice(i + 2),
  };
}

const LANE_DROPPABLE_PREFIX = "lane:";

function laneIdOfDropTarget(overId: string): string | null {
  if (!overId) return null;
  if (overId.startsWith(LANE_DROPPABLE_PREFIX)) {
    return overId.slice(LANE_DROPPABLE_PREFIX.length);
  }
  if (overId.includes("::")) {
    return overId.slice(0, overId.indexOf("::"));
  }
  return null;
}

function LaneSection({
  lane,
  boardId,
  categories,
  signedImageUrls,
  tagsByArtifact,
  membershipsByArtifact,
  allTags,
  provenanceByArtifact,
  canEdit,
  sourceLaneId,
}: {
  lane: Lane;
  boardId: string;
  categories: Category[];
  signedImageUrls: Record<string, string>;
  tagsByArtifact: Record<string, Tag[]>;
  membershipsByArtifact: Record<string, Membership[]>;
  allTags: Tag[];
  provenanceByArtifact: Record<string, ArtifactProvenance>;
  canEdit: boolean;
  sourceLaneId: string | null;
}) {
  const sortableIds = lane.artifacts.map((a) => `${lane.id}::${a.id}`);

  // Whole-lane droppable so drops on the gap below cards (and on empty
  // lanes) register. Cards inside the lane are independent droppables via
  // SortableContext — those win when the cursor is directly over a card.
  const { setNodeRef: setLaneRef, isOver: laneIsOver } = useDroppable({
    id: `${LANE_DROPPABLE_PREFIX}${lane.id}`,
    disabled: !canEdit,
  });

  const dragInProgress = sourceLaneId !== null;
  const isOtherLaneTarget = dragInProgress && sourceLaneId !== lane.id;
  const showLaneHighlight = laneIsOver && isOtherLaneTarget;

  return (
    <section
      ref={setLaneRef}
      data-lane-id={lane.id}
      className={`flex flex-col gap-5 rounded-lg border-t border-stone-200/80 pt-6 transition-colors first:border-t-0 first:pt-0 ${
        showLaneHighlight ? "bg-amber-50/50" : ""
      }`}
    >
      <header className="flex items-baseline justify-between">
        <h2
          style={{ fontFamily: SERIF }}
          className="text-2xl font-normal text-stone-800"
        >
          {lane.name}
        </h2>
        <span className="text-[11px] uppercase tracking-[0.18em] text-stone-400">
          {lane.artifacts.length}{" "}
          {lane.artifacts.length === 1 ? "item" : "items"}
        </span>
      </header>

      {lane.artifacts.length === 0 ? (
        <EmptyLaneSlot
          laneId={lane.id}
          canEdit={canEdit}
          isDragTarget={showLaneHighlight}
          dragInProgress={isOtherLaneTarget}
        />
      ) : (
        <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-2 gap-5 md:grid-cols-3 md:gap-6 lg:grid-cols-4">
            {lane.artifacts.map((art) => (
              <SortableCardWrapper
                key={`${lane.id}::${art.id}`}
                sortableId={`${lane.id}::${art.id}`}
                artifact={art}
                boardId={boardId}
                categories={categories}
                signedImageUrl={
                  art.kind === "image"
                    ? signedImageUrls[art.storagePath]
                    : undefined
                }
                tags={tagsByArtifact[art.id] ?? []}
                memberCategoryIds={
                  membershipsByArtifact[art.id]?.map((m) => m.categoryId) ?? []
                }
                allTags={allTags}
                provenance={provenanceByArtifact[art.id]}
                canEdit={canEdit}
              />
            ))}
          </div>
        </SortableContext>
      )}
    </section>
  );
}

function EmptyLaneSlot({
  laneId,
  canEdit,
  isDragTarget,
  dragInProgress,
}: {
  laneId: string;
  canEdit: boolean;
  isDragTarget: boolean;
  dragInProgress: boolean;
}) {
  // Resting copy stays subtle; drag copy reads as a clear affordance.
  const copy = !canEdit
    ? "Empty."
    : laneId === UNCATEGORIZED
      ? dragInProgress
        ? "Drop here to remove from its category"
        : "Everything is categorized."
      : dragInProgress
        ? "Drop here"
        : "Drag a card here, or assign via the card menu.";

  return (
    <div
      className={`rounded-lg border-2 border-dashed px-6 py-10 text-center text-sm italic transition-all ${
        isDragTarget
          ? "border-amber-400 bg-amber-50/80 text-stone-700"
          : "border-stone-300/70 text-stone-400"
      }`}
      style={{ fontFamily: SERIF }}
    >
      {copy}
    </div>
  );
}

function SortableCardWrapper({
  sortableId,
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
  sortableId: string;
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
    useSortable({ id: sortableId, disabled: !canEdit });

  // Read-only viewers don't get drag listeners — keeps the cursor a normal
  // pointer and avoids dnd-kit hijacking image-zoom clicks.
  const dragProps = canEdit ? { ...attributes, ...listeners } : {};

  // While the active item is being dragged, leave its slot empty (opacity 0)
  // and do NOT apply the cursor-tracking transform — the floating preview is
  // handled by the top-level <DragOverlay>. Applying a transform here would
  // get clipped by the masonry CSS-columns container, making the card look
  // stuck inside its lane.
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

function EmptyState() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-8 py-24 text-center">
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
        Drop in a photo, a listing link, or just a thought.
      </p>
    </div>
  );
}
