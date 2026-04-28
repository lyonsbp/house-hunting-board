import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent } from "@heroui/react";

import { FEATURE_TAXONOMY } from "@/lib/ai/feature-extractor";
import {
  buildCohortTable,
  pricedPropertyCount,
  type AnalyticsProperty,
  type AnalyticsSignal,
} from "@/lib/analytics/cohort";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const SERIF =
  '"Cochin", "Hoefler Text", "Iowan Old Style", "Palatino Linotype", Georgia, serif';

const LOW_N_THRESHOLD = 5;

export default async function AnalyticsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  // properties + feature_signals are both globally readable to authenticated
  // users by design (PRD §4) so analytics aggregates across everyone's
  // imports. RLS on the underlying tables enforces that no board content
  // leaks here — we never join through `artifacts`.
  const [{ data: propertyRows }, { data: signalRows }] = await Promise.all([
    supabase
      .from("properties")
      .select("id, list_price, sold_price, sqft"),
    supabase
      .from("feature_signals")
      .select("property_id, feature, confidence")
      .eq("source", "llm-extract"),
  ]);

  const properties: AnalyticsProperty[] = propertyRows ?? [];
  const signals: AnalyticsSignal[] = signalRows ?? [];

  const totalPriced = pricedPropertyCount(properties);
  const rows = buildCohortTable(properties, signals, FEATURE_TAXONOMY)
    .filter((r) => r.n > 0)
    .sort((a, b) => {
      // Sort by absolute delta desc; nulls last.
      const da = a.deltaPerSqft === null ? -Infinity : Math.abs(a.deltaPerSqft);
      const db = b.deltaPerSqft === null ? -Infinity : Math.abs(b.deltaPerSqft);
      return db - da;
    });

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:gap-10 sm:px-6 sm:py-10">
      <p className="text-[11px] uppercase tracking-[0.18em] text-stone-500">
        <Link href="/" className="hover:text-stone-900">
          ← Boards
        </Link>
      </p>
      <header className="flex flex-col gap-1">
        <p
          className="text-[10px] uppercase tracking-[0.22em] text-amber-700/80"
          style={{ letterSpacing: "0.22em" }}
        >
          Analytics
        </p>
        <h1
          style={{ fontFamily: SERIF }}
          className="text-3xl font-normal leading-tight text-stone-900 sm:text-4xl"
        >
          Feature impact on price/sqft
        </h1>
        <p className="mt-2 max-w-prose text-sm text-stone-600">
          Median price-per-sqft across {totalPriced.toLocaleString()} priced
          properties in the dataset, split by whether each feature is present.
          This is a simple cohort delta, not a causal effect — features
          correlate with each other (a pool listing also tends to have a deck),
          so deltas overstate any single feature&apos;s contribution. Treat as
          directional. Lines marked <em>low N</em> are below {LOW_N_THRESHOLD}{" "}
          properties — sample-size noise dominates there.
        </p>
      </header>

      <Card>
        <CardContent>
          {totalPriced === 0 ? (
            <EmptyState />
          ) : rows.length === 0 ? (
            <p className="text-sm text-stone-500">
              No feature signals yet. Import some listings and the extractor
              will populate this page next time around.
            </p>
          ) : (
            <CohortTable rows={rows} />
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function CohortTable({
  rows,
}: {
  rows: ReturnType<typeof buildCohortTable>;
}) {
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-stone-200 text-[10px] uppercase tracking-wider text-stone-500">
            <th className="px-2 py-2 font-medium">Feature</th>
            <th className="px-2 py-2 text-right font-medium">N</th>
            <th className="px-2 py-2 text-right font-medium">Median $/sqft (with)</th>
            <th className="px-2 py-2 text-right font-medium">Median $/sqft (without)</th>
            <th className="px-2 py-2 text-right font-medium">Δ / sqft</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isLowN = r.n < LOW_N_THRESHOLD;
            return (
              <tr
                key={r.feature}
                className={`border-b border-stone-100 ${
                  isLowN ? "text-stone-400" : "text-stone-800"
                }`}
              >
                <td className="px-2 py-2 capitalize">{r.feature}</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {r.n}
                  {isLowN && (
                    <span className="ml-1 text-[9px] uppercase text-amber-700/70">
                      low N
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {fmtMoney(r.medianWith)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {fmtMoney(r.medianWithout)}
                </td>
                <td
                  className={`px-2 py-2 text-right tabular-nums ${
                    r.deltaPerSqft === null
                      ? ""
                      : r.deltaPerSqft > 0
                        ? "text-emerald-700"
                        : "text-red-700"
                  }`}
                >
                  {fmtDelta(r.deltaPerSqft)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <p
        style={{ fontFamily: SERIF }}
        className="max-w-sm text-lg italic text-stone-500"
      >
        Nothing to compare yet. Import a few Redfin or Zillow listings and the
        feature extractor will fill this up.
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
  const sign = n > 0 ? "+" : n < 0 ? "" : "";
  return `${sign}$${Math.round(n).toLocaleString()}`;
}
