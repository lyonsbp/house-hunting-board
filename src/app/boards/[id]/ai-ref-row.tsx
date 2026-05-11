"use client";

import { useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";

import type { ReferenceRole } from "@/lib/ai/types";

import type { Slot } from "./ai-ref-types";

const ROLE_OPTIONS: ReferenceRole[] = [
  "style",
  "color",
  "materials",
  "scale",
  "placement",
  "other",
];

const ACCEPT = "image/jpeg,image/png,image/webp";

/**
 * Three-slot row presented under the AI prompt textarea. Each slot:
 *   - empty:     `+` placeholder; click → file picker; drop target for
 *                native file drag and for the BoardRefPicker drag.
 *   - uploading: spinner while we resize + upload.
 *   - filled:    thumbnail + role-pill <select> + clear `×`.
 *
 * State lives in the parent (`AiEditPanel`) because the form serializes
 * `slots.filter(filled).map(s => s.ref)` into a hidden input on submit;
 * this component is just the view + interaction surface.
 */
export function AiRefRow({
  slots,
  disabled,
  onPickFile,
  onSetRole,
  onClear,
  onPickFromBoard,
}: {
  slots: readonly [Slot, Slot, Slot];
  disabled?: boolean;
  onPickFile: (idx: 0 | 1 | 2, file: File) => void;
  onSetRole: (idx: 0 | 1 | 2, role: ReferenceRole | undefined) => void;
  onClear: (idx: 0 | 1 | 2) => void;
  onPickFromBoard: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wider text-stone-500">
          References (optional)
        </span>
        <button
          type="button"
          onClick={onPickFromBoard}
          disabled={disabled}
          className="text-[11px] text-stone-600 underline-offset-2 hover:underline disabled:opacity-50"
        >
          From board
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => {
          const idx = i as 0 | 1 | 2;
          return (
            <RefSlot
              key={i}
              idx={idx}
              slot={slots[i]}
              disabled={disabled}
              onPickFile={onPickFile}
              onSetRole={onSetRole}
              onClear={onClear}
            />
          );
        })}
      </div>
    </div>
  );
}

function RefSlot({
  idx,
  slot,
  disabled,
  onPickFile,
  onSetRole,
  onClear,
}: {
  idx: 0 | 1 | 2;
  slot: Slot;
  disabled?: boolean;
  onPickFile: (idx: 0 | 1 | 2, file: File) => void;
  onSetRole: (idx: 0 | 1 | 2, role: ReferenceRole | undefined) => void;
  onClear: (idx: 0 | 1 | 2) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // dnd-kit drop target for the BoardRefPicker. Native HTML5 drop is
  // handled separately below for OS file drags.
  const { setNodeRef, isOver } = useDroppable({
    id: `ref-slot-${idx}`,
    data: { kind: "ref-slot", idx },
    disabled,
  });

  function handleNativeDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) onPickFile(idx, file);
  }

  const highlight = isOver || dragOver;
  const baseClasses =
    "relative flex aspect-square w-full items-center justify-center rounded-lg border text-stone-400 transition-colors";
  const stateClasses = highlight
    ? "border-stone-900 bg-stone-50 text-stone-900"
    : "border-dashed border-stone-300 hover:border-stone-500";

  if (slot.kind === "empty") {
    return (
      <div className="flex flex-col gap-1">
        <button
          ref={setNodeRef}
          type="button"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleNativeDrop}
          className={`${baseClasses} ${stateClasses} disabled:opacity-50`}
          aria-label={`Add reference image ${idx + 1}`}
        >
          <span className="text-2xl leading-none">+</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPickFile(idx, f);
            e.target.value = "";
          }}
        />
      </div>
    );
  }

  if (slot.kind === "uploading") {
    return (
      <div className="flex flex-col gap-1">
        <div
          className={`${baseClasses} border-stone-300 bg-stone-50`}
          aria-label="Uploading reference"
        >
          <Spinner />
        </div>
      </div>
    );
  }

  // filled
  return (
    <div className="flex flex-col gap-1">
      <div
        ref={setNodeRef}
        className={`${baseClasses} overflow-hidden ${
          highlight ? "border-stone-900" : "border-stone-300"
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={slot.previewUrl}
          alt={`Reference ${idx + 1}`}
          className="h-full w-full object-cover"
        />
        <button
          type="button"
          onClick={() => onClear(idx)}
          disabled={disabled}
          aria-label={`Remove reference ${idx + 1}`}
          className="absolute right-1 top-1 rounded-full bg-white/90 p-0.5 text-stone-700 shadow hover:bg-white disabled:opacity-50"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <path d="M6 6 L18 18 M18 6 L6 18" />
          </svg>
        </button>
      </div>
      <select
        value={slot.ref.role ?? ""}
        onChange={(e) =>
          onSetRole(idx, (e.target.value as ReferenceRole) || undefined)
        }
        disabled={disabled}
        className="rounded border border-stone-200 bg-white px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-stone-700 focus:border-stone-400 focus:outline-none disabled:opacity-50"
        aria-label={`Reference ${idx + 1} role`}
      >
        <option value="">role…</option>
        {ROLE_OPTIONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
