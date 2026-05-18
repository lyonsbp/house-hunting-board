import Link from "next/link";

import type { CategoryTile as CategoryTileData } from "@/lib/board-data";
import { UNCATEGORIZED_ID } from "@/lib/board-data-shared";
import { slugify } from "@/lib/slug";

import { ArtifactImage } from "./artifact-image";

const SERIF =
  '"Cochin", "Hoefler Text", "Iowan Old Style", "Palatino Linotype", Georgia, serif';

/**
 * Each thumbnail is positioned absolutely inside the tile's preview
 * area. At rest the cards are a slightly-staggered "deck" stacked at
 * the center; on desktop hover they fan out into a hand of cards.
 *
 * Two design rules:
 *  1. The TOP card (highest z-index, last rendered) is always tilted
 *     the same direction at rest (+2deg) regardless of how many cards
 *     are shown — keeps the visual signature consistent.
 *  2. Single-image tiles don't fan; they zoom slightly on hover. A
 *     single card has nothing to fan against, so a scale-up reads
 *     better than a static rotation.
 *
 * `transform-origin: bottom center` makes rotation feel like the cards
 * are pivoting at a dealer's grip. Mobile/touch never hits hover, so
 * the rest state has to read cleanly on its own.
 */
type Transform = { x: number; y: number; rot: number };

const REST_BY_COUNT: Record<number, readonly Transform[]> = {
  1: [{ x: 0, y: -2, rot: 2 }],
  2: [
    { x: 0, y: 0, rot: -2 },
    { x: 0, y: -3, rot: 2 },
  ],
  3: [
    { x: 0, y: 0, rot: -3 },
    { x: 0, y: -2, rot: 0 },
    { x: 0, y: -3, rot: 2 },
  ],
  4: [
    { x: 0, y: 0, rot: -3 },
    { x: 0, y: -1, rot: -1 },
    { x: 0, y: -2, rot: 1 },
    { x: 0, y: -3, rot: 2 },
  ],
};

const FAN_BY_COUNT: Record<number, readonly Transform[]> = {
  // Single card: same position as rest. Hover scale is applied via
  // --fan-scale below; this entry just keeps the var setup uniform.
  1: [{ x: 0, y: -2, rot: 2 }],
  2: [
    { x: -14, y: 4, rot: -10 },
    { x: 14, y: 4, rot: 10 },
  ],
  3: [
    { x: -16, y: 4, rot: -14 },
    { x: 0, y: -3, rot: 0 },
    { x: 16, y: 4, rot: 14 },
  ],
  4: [
    { x: -22, y: 4, rot: -18 },
    { x: -8, y: -2, rot: -6 },
    { x: 8, y: -2, rot: 6 },
    { x: 22, y: 4, rot: 18 },
  ],
};

const SINGLE_HOVER_SCALE = "1.08";

export function CategoryTile({
  boardId,
  tile,
}: {
  boardId: string;
  tile: CategoryTileData;
}) {
  const slug =
    tile.id === UNCATEGORIZED_ID ? UNCATEGORIZED_ID : slugify(tile.name);
  const href = `/boards/${boardId}/c/${slug}`;
  const usableThumbs = tile.thumbnailUrls.slice(0, 4);
  const isEmpty = tile.count === 0;
  const hasThumbs = usableThumbs.length > 0;

  return (
    <Link
      href={href}
      className="group flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-3 transition-shadow duration-300 [@media(hover:hover)]:hover:shadow-[0_8px_28px_-12px_rgba(0,0,0,0.18)]"
    >
      <div
        className={`fan-deck relative aspect-[4/3] overflow-hidden rounded-lg ${
          isEmpty || !hasThumbs ? "bg-stone-50" : "bg-stone-100"
        }`}
      >
        {isEmpty ? (
          <div
            className="absolute inset-0 flex items-center justify-center text-sm italic text-stone-400"
            style={{ fontFamily: SERIF }}
          >
            empty
          </div>
        ) : !hasThumbs ? (
          <div
            className="absolute inset-0 flex items-center justify-center text-sm italic text-stone-500"
            style={{ fontFamily: SERIF }}
          >
            {tile.count} {tile.count === 1 ? "item" : "items"}
          </div>
        ) : (
          (() => {
            const count = usableThumbs.length as 1 | 2 | 3 | 4;
            const restList = REST_BY_COUNT[count] ?? REST_BY_COUNT[4];
            const fanList = FAN_BY_COUNT[count] ?? FAN_BY_COUNT[4];
            const fanScale = count === 1 ? SINGLE_HOVER_SCALE : "1";
            return usableThumbs.map((url: string, i: number) => {
              const rest = restList[i] ?? restList[restList.length - 1];
              const fan = fanList[i] ?? fanList[fanList.length - 1];
              return (
                <div
                  key={i}
                  style={
                    {
                      "--rest-x": `${rest.x}%`,
                      "--rest-y": `${rest.y}%`,
                      "--rest-rot": `${rest.rot}deg`,
                      "--fan-x": `${fan.x}%`,
                      "--fan-y": `${fan.y}%`,
                      "--fan-rot": `${fan.rot}deg`,
                      "--fan-scale": fanScale,
                      zIndex: i + 1,
                    } as React.CSSProperties
                  }
                  className="fan-card absolute inset-x-[18%] inset-y-[14%] origin-bottom rounded-md border-2 border-white shadow-md transition-transform duration-300 ease-out"
                >
                  <ArtifactImage
                    src={url}
                    alt=""
                    fit="cover"
                    aspectRatio={1}
                    className="h-full w-full rounded-[2px]"
                  />
                </div>
              );
            });
          })()
        )}
      </div>
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h3
          className="truncate text-xl font-normal text-stone-900"
          style={{ fontFamily: SERIF }}
        >
          {tile.name}
        </h3>
        <span className="shrink-0 text-[11px] uppercase tracking-[0.18em] text-stone-400">
          {tile.count} {tile.count === 1 ? "item" : "items"}
        </span>
      </div>
    </Link>
  );
}
