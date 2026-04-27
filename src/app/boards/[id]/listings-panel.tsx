"use client";

export type ImportedListing = {
  id: string;
  source: string;
  sourceUrl: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  listPrice: number | null;
  soldPrice: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  yearBuilt: number | null;
  status: string | null;
  scrapedAt: string;
  photoCount: number;
};

export function ListingsPanel({ listings }: { listings: ImportedListing[] }) {
  if (listings.length === 0) return null;

  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md py-1 outline-none">
        <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">
          Listings imported
          <span className="ml-2 text-stone-400 normal-case tracking-normal font-normal">
            {listings.length}
          </span>
        </h2>
        <span
          aria-hidden="true"
          className="text-xs text-stone-400 transition-transform group-open:rotate-90"
        >
          ▶
        </span>
      </summary>

      <ul className="mt-3 flex flex-col divide-y divide-stone-200">
        {listings.map((l) => (
          <ListingRow key={l.id} listing={l} />
        ))}
      </ul>
    </details>
  );
}

function ListingRow({ listing }: { listing: ImportedListing }) {
  const stats: string[] = [];
  if (listing.bedrooms !== null) stats.push(`${listing.bedrooms} bd`);
  if (listing.bathrooms !== null) stats.push(`${listing.bathrooms} ba`);
  if (listing.sqft !== null) stats.push(`${listing.sqft.toLocaleString()} sqft`);
  if (listing.yearBuilt !== null) stats.push(`built ${listing.yearBuilt}`);

  const isSold = listing.status
    ? /sold|closed/i.test(listing.status)
    : listing.soldPrice !== null && listing.listPrice === null;
  const headlineAmount = isSold
    ? listing.soldPrice ?? listing.listPrice
    : listing.listPrice ?? listing.soldPrice;
  const priceLabel = headlineAmount !== null
    ? `${isSold ? "Sold " : ""}$${headlineAmount.toLocaleString()}`
    : null;

  let host = listing.source;
  try {
    host = new URL(listing.sourceUrl).host.replace(/^www\./, "");
  } catch {
    // keep source as-is
  }

  const cityState = [listing.city, listing.state].filter(Boolean).join(", ");
  const title = listing.address ?? cityState ?? "Listing";

  return (
    <li className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-stone-900">
          {title}
          {listing.address && cityState && (
            <span className="text-stone-500"> · {cityState}</span>
          )}
        </p>
        <p className="mt-0.5 text-[11px] uppercase tracking-wide text-stone-500">
          {priceLabel ? <span className="mr-2">{priceLabel}</span> : null}
          {stats.length > 0 ? stats.join(" · ") : null}
        </p>
      </div>
      <div className="flex flex-shrink-0 items-center gap-3 text-[11px] uppercase tracking-wide text-stone-500">
        <span>
          {listing.photoCount} {listing.photoCount === 1 ? "photo" : "photos"}
        </span>
        {listing.status && (
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] text-stone-600">
            {listing.status}
          </span>
        )}
        <a
          href={listing.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-amber-700/90 hover:text-amber-900"
          style={{ letterSpacing: "0.18em" }}
        >
          {host} ↗
        </a>
        <time dateTime={listing.scrapedAt} className="text-stone-400">
          {formatScraped(listing.scrapedAt)}
        </time>
      </div>
    </li>
  );
}

function formatScraped(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
