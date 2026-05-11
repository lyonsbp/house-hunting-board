"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownPopover,
  DropdownTrigger,
} from "@heroui/react";

import { UNCATEGORIZED_ID } from "@/lib/board-data-shared";
import { slugify } from "@/lib/slug";

const SERIF =
  '"Cochin", "Hoefler Text", "Iowan Old Style", "Palatino Linotype", Georgia, serif';

export type SwitcherTile = { id: string; name: string; count: number };

/**
 * The category drill-down's title doubles as a category picker. Clicking
 * the title opens a HeroUI menu of every category on the board (plus
 * Uncategorized when orphans exist) so users can jump between siblings
 * without bouncing back to the board dashboard.
 *
 * Keeps `?mode=canvas` across switches — the server-side guard in
 * page.tsx silently drops canvas for Uncategorized, so we don't need to
 * special-case the param here.
 */
export function CategorySwitcher({
  boardId,
  currentCategoryId,
  currentDisplayName,
  tiles,
  mode,
}: {
  boardId: string;
  currentCategoryId: string;
  currentDisplayName: string;
  tiles: SwitcherTile[];
  mode?: "grid" | "canvas";
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const isUncategorized = currentCategoryId === UNCATEGORIZED_ID;

  // The dropdown's job is to jump to *another* category. Showing the
  // current one as a checked-but-disabled row was considered, but the
  // title already announces "you are here" — quieter to just filter it.
  const otherTiles = tiles.filter((t) => t.id !== currentCategoryId);

  function targetHref(tile: SwitcherTile): string {
    const slug = tile.id === UNCATEGORIZED_ID ? UNCATEGORIZED_ID : slugify(tile.name);
    const sp = new URLSearchParams(searchParams.toString());
    // Drop the existing `mode` param if the switcher is wired with mode=grid
    // (default), or carry it through when canvas. Anything else (e.g. `?debug=1`)
    // rides along.
    if (mode === "canvas") {
      sp.set("mode", "canvas");
    } else {
      sp.delete("mode");
    }
    const qs = sp.toString();
    return `/boards/${boardId}/c/${slug}${qs ? `?${qs}` : ""}`;
  }

  function go(tile: SwitcherTile) {
    startTransition(() => {
      router.push(targetHref(tile));
    });
  }

  return (
    <Dropdown>
      <DropdownTrigger
        aria-label="Switch category"
        className="group inline-flex max-w-[60vw] items-center gap-2 rounded-md px-1 -mx-1 text-stone-900 transition-colors hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 data-[focus-visible]:ring-2 data-[focus-visible]:ring-stone-400 sm:max-w-[70vw]"
      >
        <span
          role="heading"
          aria-level={1}
          style={{ fontFamily: SERIF }}
          className={`truncate text-3xl font-normal leading-tight sm:text-4xl ${
            isUncategorized ? "italic text-stone-700" : "text-stone-900"
          } ${isPending ? "opacity-60" : ""}`}
        >
          {currentDisplayName}
        </span>
        <ChevronIcon className="shrink-0 text-stone-400 transition-transform group-data-[pressed]:translate-y-px" />
      </DropdownTrigger>
      <DropdownPopover placement="bottom start">
        <DropdownMenu aria-label="Categories on this board">
          {otherTiles.map((tile) => (
            <DropdownItem key={tile.id} onAction={() => go(tile)}>
              <span className="flex w-full items-center justify-between gap-4">
                <span
                  className={
                    tile.id === UNCATEGORIZED_ID
                      ? "italic text-stone-700"
                      : "text-stone-900"
                  }
                >
                  {tile.name}
                </span>
                <span className="shrink-0 text-[11px] uppercase tracking-[0.18em] text-stone-400">
                  {tile.count} {tile.count === 1 ? "item" : "items"}
                </span>
              </span>
            </DropdownItem>
          ))}
        </DropdownMenu>
      </DropdownPopover>
    </Dropdown>
  );
}

function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
