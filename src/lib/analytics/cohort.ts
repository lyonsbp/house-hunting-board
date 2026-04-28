/**
 * Cohort-comparison analytics for the M5 price-features page.
 *
 * Pure functions over already-fetched `properties` + `feature_signals`
 * rows. The page-level RSC does the DB I/O (and respects RLS — both
 * tables are globally readable to authenticated users per PRD §4) and
 * pipes the rows into these helpers, which compute median price-per-sqft
 * for the "with feature" cohort vs the rest of the dataset.
 *
 * We use median (vs mean) to keep one $5M outlier in a small dataset
 * from dominating, and price-per-sqft (vs absolute) to absorb at least
 * the size dimension of a normalization that hedonic regression would do
 * properly. Both are honest-but-not-perfect — see the README on M5 for
 * why this isn't a real causal effect estimate.
 */

import { metroForZip } from "./metros";

export type AnalyticsProperty = {
  id: string;
  /** Sold price wins over list price; either is acceptable input. */
  list_price: number | null;
  sold_price: number | null;
  sqft: number | null;
  /** Geographic fields for the metro filter. */
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

export type AnalyticsSignal = {
  property_id: string;
  feature: string;
  confidence: number | null;
};

export type CohortRow = {
  feature: string;
  /** Number of properties in the dataset with this feature at confidence ≥ threshold. */
  n: number;
  /** Number of properties without this feature in the priced dataset. */
  nWithout: number;
  /** Median price-per-sqft among properties with the feature. */
  medianWith: number | null;
  /** Median price-per-sqft among the rest of the dataset. */
  medianWithout: number | null;
  /** medianWith - medianWithout. Null when either side is empty. */
  deltaPerSqft: number | null;
};

const DEFAULT_CONFIDENCE_THRESHOLD = 0.4;

/** Headline price for a property: sold price preferred, list price fallback. */
export function headlinePrice(p: AnalyticsProperty): number | null {
  if (typeof p.sold_price === "number" && p.sold_price > 0) return p.sold_price;
  if (typeof p.list_price === "number" && p.list_price > 0) return p.list_price;
  return null;
}

/** Price-per-sqft, or null if either input is missing/zero. */
export function pricePerSqft(p: AnalyticsProperty): number | null {
  const price = headlinePrice(p);
  if (price === null) return null;
  if (!p.sqft || p.sqft <= 0) return null;
  return price / p.sqft;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Build a per-feature cohort table. Skips properties without a usable
 * price-per-sqft. A property is "with" a feature when it has at least
 * one feature_signals row at or above the confidence threshold.
 *
 * `metro` (optional) restricts the input to properties whose ZIP maps
 * to the given metro name via `metroForZip`. Properties outside any
 * known metro are excluded when a filter is active.
 */
export function buildCohortTable(
  properties: AnalyticsProperty[],
  signals: AnalyticsSignal[],
  features: readonly string[],
  opts: { confidenceThreshold?: number; metro?: string | null } = {},
): CohortRow[] {
  const threshold = opts.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const filteredProperties = opts.metro
    ? filterByMetro(properties, opts.metro)
    : properties;
  // Operate on the filtered set going forward.
  properties = filteredProperties;

  // Property id -> price/sqft (only for priced+sized properties).
  const ppsByProperty = new Map<string, number>();
  for (const p of properties) {
    const v = pricePerSqft(p);
    if (v !== null) ppsByProperty.set(p.id, v);
  }

  // feature -> set of property ids that have it strongly enough.
  const propsByFeature = new Map<string, Set<string>>();
  for (const s of signals) {
    if (typeof s.confidence === "number" && s.confidence < threshold) continue;
    const set = propsByFeature.get(s.feature) ?? new Set<string>();
    set.add(s.property_id);
    propsByFeature.set(s.feature, set);
  }

  return features.map((feature) => {
    const withSet = propsByFeature.get(feature) ?? new Set();
    const withVals: number[] = [];
    const withoutVals: number[] = [];
    for (const [pid, pps] of ppsByProperty.entries()) {
      if (withSet.has(pid)) withVals.push(pps);
      else withoutVals.push(pps);
    }
    const medianWith = median(withVals);
    const medianWithout = median(withoutVals);
    return {
      feature,
      n: withVals.length,
      nWithout: withoutVals.length,
      medianWith,
      medianWithout,
      deltaPerSqft:
        medianWith !== null && medianWithout !== null
          ? medianWith - medianWithout
          : null,
    };
  });
}

/**
 * Total priced properties — useful for the "dataset size: N" header.
 * Honors the same metro filter as `buildCohortTable` so the header N and
 * the table cohort sizes stay consistent.
 */
export function pricedPropertyCount(
  properties: AnalyticsProperty[],
  opts: { metro?: string | null } = {},
): number {
  const scoped = opts.metro ? filterByMetro(properties, opts.metro) : properties;
  let n = 0;
  for (const p of scoped) if (pricePerSqft(p) !== null) n++;
  return n;
}

function filterByMetro(
  properties: AnalyticsProperty[],
  metro: string,
): AnalyticsProperty[] {
  return properties.filter((p) => metroForZip(p.zip) === metro);
}
