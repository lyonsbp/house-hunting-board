"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { CohortRow } from "@/lib/analytics/cohort";

import { getFeatureCohort } from "./feature-actions";

const SERIF =
  '"Cochin", "Hoefler Text", "Iowan Old Style", "Palatino Linotype", Georgia, serif';

/**
 * Click-on-chip drilldown. Native `<dialog>` to match the rest of the
 * app's modal pattern; pointer events stop here so the surrounding
 * dnd-kit listeners on the canvas don't get confused. Defaults to the
 * listing's metro and falls back to global ("All metros") when the ZIP
 * doesn't map to any of our top-N regions.
 */
export function FeatureCohortPopover({
  feature,
  metro,
  onClose,
}: {
  feature: string;
  metro: string | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<
    | { row: CohortRow; totalPriced: number }
    | { error: string }
    | null
  >(null);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (!dlg.open) dlg.showModal();
    return () => {
      if (dlg.open) dlg.close();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getFeatureCohort({ feature, metro }).then((res) => {
      if (!cancelled) setData(res);
    });
    return () => {
      cancelled = true;
    };
  }, [feature, metro]);

  const scopeLabel = metro ?? "all metros";
  const analyticsHref = metro
    ? `/analytics?metro=${encodeURIComponent(metro)}`
    : `/analytics`;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      className="m-0 mx-auto my-auto max-h-[85dvh] w-[min(420px,95vw)] rounded-2xl border border-stone-200 bg-white p-5 shadow-2xl backdrop:bg-stone-900/30 backdrop:backdrop-blur-sm sm:p-6"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-amber-700/80">
              Feature
            </p>
            <h3
              style={{ fontFamily: SERIF }}
              className="text-xl text-stone-900 capitalize"
            >
              {feature}
            </h3>
            <p className="mt-0.5 text-[11px] uppercase tracking-wide text-stone-500">
              in {scopeLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-stone-400 hover:text-stone-700"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6 L18 18 M18 6 L6 18" />
            </svg>
          </button>
        </div>

        {data === null ? (
          <p className="text-sm text-stone-500">Crunching the cohort…</p>
        ) : "error" in data ? (
          <p className="text-sm text-red-700">{data.error}</p>
        ) : (
          <CohortBody row={data.row} totalPriced={data.totalPriced} />
        )}

        <Link
          href={analyticsHref}
          className="self-start text-[11px] uppercase tracking-[0.18em] text-amber-700/90 hover:text-amber-900"
        >
          See all features in {scopeLabel} →
        </Link>
      </div>
    </dialog>
  );
}

function CohortBody({
  row,
  totalPriced,
}: {
  row: CohortRow;
  totalPriced: number;
}) {
  const hasComparison = row.medianWith !== null && row.medianWithout !== null;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] uppercase tracking-wide text-stone-500">
        {row.n} of {totalPriced.toLocaleString()} priced properties have this
        feature
      </p>

      {!hasComparison ? (
        <p className="text-sm text-stone-600">
          Not enough data in this scope to compute a delta yet. Try widening to{" "}
          <em>all metros</em>, or import more listings.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-stone-500">
              With
            </p>
            <p className="mt-0.5 text-base font-medium tabular-nums text-stone-900">
              {fmtMoney(row.medianWith)}
            </p>
            <p className="text-[10px] text-stone-400">N = {row.n}</p>
          </div>
          <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-stone-500">
              Without
            </p>
            <p className="mt-0.5 text-base font-medium tabular-nums text-stone-900">
              {fmtMoney(row.medianWithout)}
            </p>
            <p className="text-[10px] text-stone-400">N = {row.nWithout}</p>
          </div>
        </div>
      )}

      {row.deltaPerSqft !== null && (
        <p
          className={`text-sm tabular-nums ${
            row.deltaPerSqft > 0 ? "text-emerald-700" : "text-red-700"
          }`}
        >
          Δ {fmtDelta(row.deltaPerSqft)} per sqft
        </p>
      )}

      <p className="text-[11px] text-stone-500">
        Median price-per-sqft. Cohort delta — directional, not causal.
      </p>
    </div>
  );
}

function fmtMoney(n: number | null): string {
  if (n === null) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

function fmtDelta(n: number | null): string {
  if (n === null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}$${Math.round(n).toLocaleString()}`;
}
