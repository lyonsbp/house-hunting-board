"use client";

import { useRouter, useSearchParams } from "next/navigation";

const SERIF =
  '"Cochin", "Hoefler Text", "Iowan Old Style", "Palatino Linotype", Georgia, serif';

export type ViewMode = "grid" | "canvas";

/**
 * Segmented [Grid | Canvas] control for a drill-down view. Mirrors
 * state to `?mode=` so the chosen view survives reloads and is
 * shareable. `router.replace` (not `push`) keeps the toggle out of the
 * back-stack — flipping back and forth shouldn't litter history.
 *
 * Hidden by the parent on the Uncategorized drill-down (canvas mode is
 * unsupported there because there's no `artifact_categories` row to
 * attach positions to).
 */
export function ModeToggle({ mode }: { mode: ViewMode }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setMode(next: ViewMode) {
    if (next === mode) return;
    const sp = new URLSearchParams(searchParams.toString());
    if (next === "grid") {
      sp.delete("mode");
    } else {
      sp.set("mode", next);
    }
    const qs = sp.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  }

  return (
    <div
      className="inline-flex shrink-0 items-stretch rounded-full border border-stone-300 bg-stone-50 p-0.5 text-sm"
      role="group"
      aria-label="View mode"
    >
      <ToggleButton
        active={mode === "grid"}
        onClick={() => setMode("grid")}
        label="Grid"
      />
      <ToggleButton
        active={mode === "canvas"}
        onClick={() => setMode("canvas")}
        label="Canvas"
      />
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-4 py-1.5 transition-colors ${
        active
          ? "bg-stone-900 text-stone-50"
          : "text-stone-500 hover:text-stone-800"
      }`}
      style={{ fontFamily: SERIF }}
    >
      {label}
    </button>
  );
}
