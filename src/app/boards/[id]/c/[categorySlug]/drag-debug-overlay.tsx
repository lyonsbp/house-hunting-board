"use client";

import { useState } from "react";
import {
  useDndContext,
  useDndMonitor,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

/**
 * On-screen drag debug panel. Mount this inside a `<DndContext>` and
 * gate via `?debug=1` so it never shows for normal users.
 *
 * What it surfaces:
 *  - Current drag phase + active id + last delta
 *  - Live `over.id` (which droppable dnd-kit thinks the cursor is over)
 *  - Every registered droppable's id + bounding rect (so you can spot
 *    stale rects, droppables registered without a rect, etc.)
 *
 * Tap "Copy" to dump a JSON snapshot to the clipboard for sharing.
 */
export function DragDebugOverlay() {
  const ctx = useDndContext();
  const [phase, setPhase] = useState<string>("idle");
  const [last, setLast] = useState<{
    active: string | null;
    over: string | null;
    deltaX: number;
    deltaY: number;
  }>({ active: null, over: null, deltaX: 0, deltaY: 0 });

  useDndMonitor({
    onDragStart(e: DragStartEvent) {
      setPhase("dragging");
      setLast({
        active: String(e.active.id),
        over: null,
        deltaX: 0,
        deltaY: 0,
      });
    },
    onDragMove(e: DragMoveEvent) {
      setLast({
        active: String(e.active.id),
        over: e.over ? String(e.over.id) : null,
        deltaX: e.delta.x,
        deltaY: e.delta.y,
      });
    },
    onDragEnd(e: DragEndEvent) {
      setPhase("idle");
      setLast({
        active: String(e.active.id),
        over: e.over ? String(e.over.id) : null,
        deltaX: e.delta.x,
        deltaY: e.delta.y,
      });
    },
    onDragCancel() {
      setPhase("cancelled");
    },
  });

  const droppables = Array.from(ctx.droppableContainers.getEnabled()).map(
    (c) => {
      const rect = ctx.droppableRects.get(c.id);
      return {
        id: String(c.id),
        rect: rect
          ? {
              top: Math.round(rect.top),
              left: Math.round(rect.left),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            }
          : null,
      };
    },
  );

  function copy() {
    const snapshot = {
      phase,
      active: ctx.active?.id ?? null,
      over: ctx.over?.id ?? null,
      lastEvent: last,
      droppables,
    };
    void navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
  }

  return (
    <div className="fixed right-2 top-2 z-[10000] max-h-[85vh] w-80 overflow-auto rounded-lg border-2 border-red-500 bg-white p-3 font-mono text-[11px] leading-snug text-stone-800 shadow-2xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-bold">DnD Debug</span>
        <button
          type="button"
          onClick={copy}
          className="rounded border border-stone-400 px-2 py-0.5 hover:bg-stone-100"
        >
          Copy JSON
        </button>
      </div>
      <Row label="phase" value={phase} />
      <Row label="active" value={ctx.active ? String(ctx.active.id) : "—"} />
      <Row label="over" value={ctx.over ? String(ctx.over.id) : "—"} />
      <Row
        label="delta"
        value={`${Math.round(last.deltaX)}, ${Math.round(last.deltaY)}`}
      />
      <hr className="my-2 border-stone-300" />
      <div className="mb-1 font-semibold">
        droppables ({droppables.length})
      </div>
      <ul className="space-y-1">
        {droppables.map((d) => {
          const isOver = ctx.over && String(ctx.over.id) === d.id;
          return (
            <li
              key={d.id}
              className={`rounded px-1 py-0.5 ${
                isOver ? "bg-amber-100" : ""
              }`}
            >
              <div className="font-semibold">{d.id}</div>
              {d.rect ? (
                <div className="text-stone-500">
                  top={d.rect.top} left={d.rect.left} {d.rect.width}×
                  {d.rect.height}
                </div>
              ) : (
                <div className="text-red-600">no rect</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-stone-500">{label}</span>
      <span className="truncate text-stone-900">{value}</span>
    </div>
  );
}
