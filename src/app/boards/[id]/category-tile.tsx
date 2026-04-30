import Link from "next/link";

import type { CategoryTile as CategoryTileData } from "@/lib/board-data";

const SERIF =
  '"Cochin", "Hoefler Text", "Iowan Old Style", "Palatino Linotype", Georgia, serif';

/**
 * Each thumbnail is positioned absolutely inside the tile's preview
 * area. At rest the cards are a slightly-staggered "deck" stacked at
 * the center; on desktop hover they fan out into a hand of cards.
 *
 * `transform-origin: bottom center` makes the rotation feel like the
 * cards are pivoting at the dealer's grip — that's the natural fan
 * geometry. Mobile/touch never hits hover so the rest state has to read
 * cleanly on its own.
 */
const REST_TRANSFORMS = [
  { x: 0, y: 0, rot: -3 },
  { x: 0, y: -2, rot: -1 },
  { x: 0, y: -3, rot: 1 },
  { x: 0, y: -4, rot: 3 },
] as const;

const FAN_TRANSFORMS = [
  { x: -22, y: 4, rot: -18 },
  { x: -8, y: -2, rot: -6 },
  { x: 8, y: -2, rot: 6 },
  { x: 22, y: 4, rot: 18 },
] as const;

export function CategoryTile({
  boardId,
  tile,
  signedThumbUrls,
}: {
  boardId: string;
  tile: CategoryTileData;
  signedThumbUrls: Record<string, string>;
}) {
  const href = `/boards/${boardId}/c/${tile.id}`;
  const usableThumbs = tile.thumbnailPaths
    .map((path) => signedThumbUrls[path])
    .filter((url): url is string => !!url)
    .slice(0, 4);
  const isEmpty = tile.count === 0;
  const hasThumbs = usableThumbs.length > 0;

  return (
    <Link
      href={href}
      className="group flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-3 transition-shadow duration-300 [@media(hover:hover)]:hover:shadow-[0_8px_28px_-12px_rgba(0,0,0,0.18)]"
    >
      <div
        className={`relative aspect-[4/3] overflow-hidden rounded-lg ${
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
          usableThumbs.map((url, i) => {
            const rest = REST_TRANSFORMS[i] ?? REST_TRANSFORMS[3];
            const fan = FAN_TRANSFORMS[i] ?? FAN_TRANSFORMS[3];
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
                    transform:
                      "translate(var(--rest-x), var(--rest-y)) rotate(var(--rest-rot))",
                    zIndex: i + 1,
                  } as React.CSSProperties
                }
                className="absolute inset-x-[18%] inset-y-[14%] origin-bottom overflow-hidden rounded-md border-2 border-white shadow-md transition-transform duration-300 ease-out [@media(hover:hover)]:group-hover:[transform:translate(var(--fan-x),var(--fan-y))_rotate(var(--fan-rot))]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
            );
          })
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
