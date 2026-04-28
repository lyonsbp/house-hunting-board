"use client";

import { useState, useTransition } from "react";

import { FeatureCohortPopover } from "./feature-cohort-popover";
import { extractFeaturesForProperty } from "./feature-actions";
import { refreshListing } from "./refresh-listing-actions";

export type ImportedListingFeature = {
  feature: string;
  /** 0..1 — model's confidence that the feature applies. */
  confidence: number;
};

export type PriorSnapshot = {
  listPrice: number | null;
  soldPrice: number | null;
  status: string | null;
  scrapedAt: string;
};

export type PriceHistoryEntry = {
  listPrice: number | null;
  soldPrice: number | null;
  status: string | null;
  scrapedAt: string;
  /** 'listing' (event from the source's own history) or 'scrape' (we polled). */
  source: string;
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
  /** Metro name from metroForZip(zip), or null when ZIP is unknown. */
  metro: string | null;
  /**
   * Most recent property_snapshots row prior to the current state.
   * Present only when the listing has been refreshed at least once.
   */
  priorSnapshot?: PriorSnapshot;
  /**
   * Full deduped timeline of snapshots for this property, oldest first.
   * Present whenever there's at least one snapshot row for the property.
   */
  priceHistory?: PriceHistoryEntry[];
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
  const [refreshPending, startRefreshTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  function reextract() {
    setError(null);
    startTransition(async () => {
      const res = await extractFeaturesForProperty(listing.id);
      if ("error" in res) setError(res.error);
    });
  }

  function refresh() {
    setRefreshError(null);
    startRefreshTransition(async () => {
      const res = await refreshListing({ propertyId: listing.id });
      if ("error" in res) setRefreshError(res.error);
    });
  }

  return (
    <ListingRowInner
      listing={listing}
      pending={pending}
      error={error}
      onReextract={reextract}
      refreshPending={refreshPending}
      refreshError={refreshError}
      onRefresh={refresh}
      historyOpen={historyOpen}
      setHistoryOpen={setHistoryOpen}
    />
  );
}

function ListingRowInner({
  listing,
  pending,
  error,
  onReextract,
  refreshPending,
  refreshError,
  onRefresh,
  historyOpen,
  setHistoryOpen,
}: {
  listing: ImportedListing;
  pending: boolean;
  error: string | null;
  onReextract: () => void;
  refreshPending: boolean;
  refreshError: string | null;
  onRefresh: () => void;
  historyOpen: boolean;
  setHistoryOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
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

  const priorHeadline = priorHeadlineAmount(listing);
  const headlineDelta =
    headlineAmount !== null && priorHeadline !== null && priorHeadline !== headlineAmount
      ? headlineAmount - priorHeadline
      : null;
  const statusChanged =
    !!listing.priorSnapshot &&
    (listing.priorSnapshot.status ?? null) !== (listing.status ?? null) &&
    listing.priorSnapshot.status !== null;

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
            {headlineDelta !== null && listing.priorSnapshot && (
              <span
                className={`mr-2 normal-case tracking-normal ${
                  headlineDelta < 0 ? "text-emerald-700" : "text-red-700"
                }`}
                title={`Previous: $${(priorHeadline ?? 0).toLocaleString()} on ${formatScraped(
                  listing.priorSnapshot.scrapedAt,
                )}`}
              >
                {headlineDelta < 0 ? "↓" : "↑"}$
                {Math.abs(headlineDelta).toLocaleString()} since{" "}
                {formatScraped(listing.priorSnapshot.scrapedAt)}
              </span>
            )}
            {statusChanged && listing.priorSnapshot && (
              <span
                className="mr-2 normal-case tracking-normal text-amber-700"
                title={`Was ${listing.priorSnapshot.status} on ${formatScraped(
                  listing.priorSnapshot.scrapedAt,
                )}`}
              >
                {listing.priorSnapshot.status} → {listing.status}
              </span>
            )}
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
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshPending}
            className="text-stone-400 hover:text-stone-700 disabled:opacity-50"
            title="Re-scrape the source listing for fresh price + status"
          >
            {refreshPending ? "Refreshing…" : "Refresh"}
          </button>
          {(listing.priceHistory?.length ?? 0) > 1 && (
            <button
              type="button"
              onClick={() => setHistoryOpen((v) => !v)}
              className="text-stone-400 hover:text-stone-700"
              title="Toggle the listing's full price + status timeline"
              aria-expanded={historyOpen}
            >
              {historyOpen ? "Hide history" : "History"}
            </button>
          )}
          <time dateTime={listing.scrapedAt} className="text-stone-400">
            {formatScraped(listing.scrapedAt)}
          </time>
        </div>
      </div>

      {refreshError && (
        <p className="text-[11px] text-red-700">{refreshError}</p>
      )}

      {historyOpen && listing.priceHistory && (
        <PriceHistoryTimeline entries={listing.priceHistory} />
      )}

      {(featureList.length > 0 || pending || error) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {visibleFeatures.map((f) => (
            <FeatureChip
              key={f.feature}
              feature={f.feature}
              confidence={f.confidence}
              metro={listing.metro}
            />
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

/**
 * Match the headline-amount logic used for `priceLabel` so the delta
 * compares apples-to-apples — sold price wins over list price both for
 * the current row and for the prior snapshot it's compared against.
 */
function priorHeadlineAmount(listing: ImportedListing): number | null {
  const prior = listing.priorSnapshot;
  if (!prior) return null;
  const currentIsSold =
    !!listing.status && /sold|closed/i.test(listing.status);
  if (currentIsSold) return prior.soldPrice ?? prior.listPrice ?? null;
  return prior.listPrice ?? prior.soldPrice ?? null;
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

function PriceHistoryTimeline({ entries }: { entries: PriceHistoryEntry[] }) {
  // Newest first when displayed — most users want to see "what changed
  // recently?" before "what was the original list price?". Original
  // ordering in the data is oldest-first; reverse for display.
  const ordered = [...entries].reverse();

  return (
    <ol className="ml-1 mt-1 flex flex-col gap-2 border-l border-stone-200 pl-4 text-[12px]">
      {ordered.map((e, i) => {
        const next = ordered[i + 1]; // older entry
        const headlinePrice = e.soldPrice ?? e.listPrice ?? null;
        const priorPrice = next ? (next.soldPrice ?? next.listPrice ?? null) : null;
        const delta =
          headlinePrice !== null && priorPrice !== null && headlinePrice !== priorPrice
            ? headlinePrice - priorPrice
            : null;
        const label = e.status ?? (e.source === "scrape" ? "Observed" : "Event");
        return (
          <li key={`${e.scrapedAt}-${i}`} className="relative">
            <span
              aria-hidden="true"
              className={`absolute -left-[18px] top-1 inline-block h-2 w-2 rounded-full ${
                e.source === "scrape"
                  ? "bg-stone-300 ring-2 ring-stone-100"
                  : "bg-amber-700/80 ring-2 ring-amber-100"
              }`}
            />
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-medium text-stone-800">{label}</span>
              <time
                dateTime={e.scrapedAt}
                className="text-[11px] uppercase tracking-wide text-stone-400"
              >
                {formatScraped(e.scrapedAt)}
              </time>
              {headlinePrice !== null && (
                <span className="tabular-nums text-stone-700">
                  ${headlinePrice.toLocaleString()}
                </span>
              )}
              {delta !== null && (
                <span
                  className={`tabular-nums ${
                    delta < 0 ? "text-emerald-700" : "text-red-700"
                  }`}
                >
                  {delta < 0 ? "↓" : "↑"}${Math.abs(delta).toLocaleString()}
                </span>
              )}
              {e.source === "scrape" && (
                <span className="text-[10px] uppercase tracking-wide text-stone-400">
                  scrape
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function FeatureChip({
  feature,
  confidence,
  metro,
}: {
  feature: string;
  confidence: number;
  metro: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Confidence ${(confidence * 100).toFixed(0)}% — click for cohort delta`}
        className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-900 ring-1 ring-amber-200 transition-colors hover:bg-amber-100 hover:ring-amber-300"
      >
        {feature}
      </button>
      {open && (
        <FeatureCohortPopover
          feature={feature}
          metro={metro}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
