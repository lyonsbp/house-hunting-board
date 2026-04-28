"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useTransition } from "react";

import { listMetroNames } from "@/lib/analytics/metros";

const ALL_METROS = "__all__";

/**
 * Dropdown that mirrors its selection to a `?metro=` query param. The
 * page-level RSC reads that param and pre-filters its cohort math, so
 * choosing a metro here triggers a server-side recompute on next render.
 *
 * Metros are split into "Has data" (selectable) and "No data yet"
 * (disabled) `<optgroup>`s based on which metros have ≥1 priced property
 * in the dataset. `<optgroup disabled>` greys out all options inside it
 * — gives a clear visual signal that filtering to those metros today
 * would just yield an empty cohort.
 *
 * Using `router.replace` (not `push`) so the back-stack stays clean —
 * users hop between metros without polluting browser history.
 */
export function MetroFilter({
  metrosWithData,
}: {
  /** Pre-computed by the server: metros that have ≥1 priced property. */
  metrosWithData: readonly string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const current = searchParams.get("metro") ?? ALL_METROS;

  const { withData, withoutData } = useMemo(() => {
    const dataSet = new Set(metrosWithData);
    const all = listMetroNames();
    return {
      withData: all.filter((m) => dataSet.has(m)),
      withoutData: all.filter((m) => !dataSet.has(m)),
    };
  }, [metrosWithData]);

  function onChange(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === ALL_METROS) {
      params.delete("metro");
    } else {
      params.set("metro", next);
    }
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `/analytics?${qs}` : "/analytics");
    });
  }

  return (
    <label className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-stone-500">
      Metro
      <select
        value={current}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
        className="rounded-md border border-stone-200 bg-white px-2 py-1 text-xs normal-case tracking-normal text-stone-900 focus:border-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-200 disabled:opacity-50"
      >
        <option value={ALL_METROS}>All metros</option>
        {withData.length > 0 && (
          <optgroup label="Has data">
            {withData.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </optgroup>
        )}
        {withoutData.length > 0 && (
          <optgroup label="No data yet" disabled>
            {withoutData.map((m) => (
              <option key={m} value={m} disabled>
                {m}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {pending && <span className="text-[10px] text-stone-400">Updating…</span>}
    </label>
  );
}
