"use client";

import { useState, useTransition } from "react";

import { extractFeaturesForProperty } from "./feature-actions";

export type ImportedListingFeature = {
  feature: string;
  /** 0..1 — model's confidence that the feature applies. */
  confidence: number;
};

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
  features?: ImportedListingFeature[];
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
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function reextract() {
    setError(null);
    startTransition(async () => {
      const res = await extractFeaturesForProperty(listing.id);
      if ("error" in res) setError(res.error);
    });
  }

  return <ListingRowInner listing={listing} pending={pending} error={error} onReextract={reextract} />;
}

function ListingRowInner({
  listing,
  pending,
  error,
  onReextract,
}: {
  listing: ImportedListing;
  pending: boolean;
  error: string | null;
  onReextract: () => void;
}) {
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

  // Show top-N strongest features inline; collapse rest behind "+M".
  const featureList = (listing.features ?? []).filter((f) => f.confidence >= 0.4);
  const visibleFeatures = featureList.slice(0, 5);
  const extraFeatures = Math.max(0, featureList.length - visibleFeatures.length);

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
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
        <div className="flex flex-shrink-0 flex-wrap items-center gap-3 text-[11px] uppercase tracking-wide text-stone-500">
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
      </div>

      {(featureList.length > 0 || pending || error) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {visibleFeatures.map((f) => (
            <span
              key={f.feature}
              title={`Confidence ${(f.confidence * 100).toFixed(0)}%`}
              className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-900 ring-1 ring-amber-200"
            >
              {f.feature}
            </span>
          ))}
          {extraFeatures > 0 && (
            <span className="text-[10px] text-stone-400">+{extraFeatures}</span>
          )}
          <button
            type="button"
            onClick={onReextract}
            disabled={pending}
            className="ml-1 text-[10px] uppercase tracking-wider text-stone-400 hover:text-stone-700 disabled:opacity-50"
          >
            {pending ? "Re-extracting…" : featureList.length > 0 ? "Re-extract" : "Extract features"}
          </button>
          {error && <span className="text-[10px] text-red-700">{error}</span>}
        </div>
      )}

      {featureList.length === 0 && !pending && !error && (
        <button
          type="button"
          onClick={onReextract}
          className="self-start text-[10px] uppercase tracking-wider text-stone-400 hover:text-stone-700"
        >
          Extract features
        </button>
      )}
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
