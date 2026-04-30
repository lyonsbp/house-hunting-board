import Link from "next/link";

import type { CategoryTile as CategoryTileData } from "@/lib/board-data";

const SERIF =
  '"Cochin", "Hoefler Text", "Iowan Old Style", "Palatino Linotype", Georgia, serif';

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

  // 2×2 thumbnail grid. Slots not filled by the top-N images render as a
  // soft stone block so the tile shape stays uniform across sparse and
  // full categories.
  const slots: (string | null)[] = [0, 1, 2, 3].map((i) => {
    const path = tile.thumbnailPaths[i];
    return path ? (signedThumbUrls[path] ?? null) : null;
  });
  const isEmpty = tile.count === 0;

  return (
    <Link
      href={href}
      className="group flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-3 transition-shadow duration-300 hover:shadow-[0_8px_28px_-12px_rgba(0,0,0,0.18)]"
    >
      <div
        className={`grid aspect-[4/3] grid-cols-2 grid-rows-2 gap-1 overflow-hidden rounded-lg ${
          isEmpty ? "bg-stone-50" : "bg-stone-100"
        }`}
      >
        {isEmpty ? (
          <div
            className="col-span-2 row-span-2 flex items-center justify-center text-sm italic text-stone-400"
            style={{ fontFamily: SERIF }}
          >
            empty
          </div>
        ) : (
          slots.map((url, i) => (
            <div
              key={i}
              className="overflow-hidden bg-stone-200 transition-transform duration-300 [@media(hover:hover)]:group-hover:scale-[1.02]"
            >
              {url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={url}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : null}
            </div>
          ))
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
