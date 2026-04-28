import { describe, expect, it } from "vitest";

import {
  buildCohortTable,
  headlinePrice,
  median,
  pricePerSqft,
  pricedPropertyCount,
  type AnalyticsProperty,
  type AnalyticsSignal,
} from "@/lib/analytics/cohort";

const FEATURES = ["pool", "waterfall island"] as const;

describe("median", () => {
  it("returns the middle value for an odd-length array", () => {
    expect(median([1, 2, 3, 4, 5])).toBe(3);
  });
  it("averages the two middle values for an even-length array", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("returns null for empty arrays", () => {
    expect(median([])).toBeNull();
  });
  it("doesn't mutate the input", () => {
    const arr = [3, 1, 2];
    median(arr);
    expect(arr).toEqual([3, 1, 2]);
  });
});

describe("headlinePrice", () => {
  it("prefers sold over list", () => {
    expect(
      headlinePrice({ id: "a", sold_price: 900_000, list_price: 1_000_000, sqft: 1000 }),
    ).toBe(900_000);
  });
  it("falls back to list when no sold", () => {
    expect(
      headlinePrice({ id: "a", sold_price: null, list_price: 750_000, sqft: 1000 }),
    ).toBe(750_000);
  });
  it("returns null when both are missing", () => {
    expect(headlinePrice({ id: "a", sold_price: null, list_price: null, sqft: 1000 })).toBeNull();
  });
  it("treats zero as missing", () => {
    expect(
      headlinePrice({ id: "a", sold_price: 0, list_price: 0, sqft: 1000 }),
    ).toBeNull();
  });
});

describe("pricePerSqft", () => {
  it("divides headline price by sqft", () => {
    expect(
      pricePerSqft({ id: "a", sold_price: null, list_price: 800_000, sqft: 1000 }),
    ).toBe(800);
  });
  it("returns null when sqft is zero / missing", () => {
    expect(
      pricePerSqft({ id: "a", sold_price: null, list_price: 800_000, sqft: 0 }),
    ).toBeNull();
    expect(
      pricePerSqft({ id: "a", sold_price: null, list_price: 800_000, sqft: null }),
    ).toBeNull();
  });
});

describe("buildCohortTable", () => {
  const properties: AnalyticsProperty[] = [
    // 1000/sqft, has pool
    { id: "p1", sold_price: 1_000_000, list_price: null, sqft: 1000 },
    // 1100/sqft, has pool + waterfall island
    { id: "p2", sold_price: 2_200_000, list_price: null, sqft: 2000 },
    // 600/sqft, no features
    { id: "p3", sold_price: null, list_price: 1_200_000, sqft: 2000 },
    // 700/sqft, no features
    { id: "p4", sold_price: 1_400_000, list_price: null, sqft: 2000 },
    // missing sqft — excluded entirely
    { id: "p5", sold_price: 500_000, list_price: null, sqft: null },
  ];

  const signals: AnalyticsSignal[] = [
    { property_id: "p1", feature: "pool", confidence: 0.9 },
    { property_id: "p2", feature: "pool", confidence: 0.5 },
    { property_id: "p2", feature: "waterfall island", confidence: 0.95 },
    // Below threshold — should be ignored.
    { property_id: "p3", feature: "pool", confidence: 0.2 },
  ];

  it("computes per-feature with/without medians and delta", () => {
    const rows = buildCohortTable(properties, signals, FEATURES);
    const pool = rows.find((r) => r.feature === "pool")!;
    const wi = rows.find((r) => r.feature === "waterfall island")!;

    // pool cohort: p1 (1000), p2 (1100). Median 1050.
    expect(pool.n).toBe(2);
    expect(pool.medianWith).toBe(1050);
    // without: p3 (600), p4 (700). Median 650.
    expect(pool.nWithout).toBe(2);
    expect(pool.medianWithout).toBe(650);
    expect(pool.deltaPerSqft).toBe(400);

    // waterfall island cohort: p2 (1100). Median 1100.
    expect(wi.n).toBe(1);
    expect(wi.medianWith).toBe(1100);
    // without: p1, p3, p4 → 600, 700, 1000 → median 700.
    expect(wi.nWithout).toBe(3);
    expect(wi.medianWithout).toBe(700);
    expect(wi.deltaPerSqft).toBe(400);
  });

  it("yields null deltas when one side of the cohort is empty", () => {
    const rows = buildCohortTable(
      [
        { id: "p1", sold_price: 1_000_000, list_price: null, sqft: 1000 },
      ],
      [],
      FEATURES,
    );
    for (const r of rows) {
      expect(r.n).toBe(0);
      expect(r.medianWith).toBeNull();
      expect(r.deltaPerSqft).toBeNull();
    }
  });

  it("respects a custom confidence threshold", () => {
    // Drop pool from p1 below threshold by raising it; p2 stays at 0.5.
    const rows = buildCohortTable(properties, signals, FEATURES, {
      confidenceThreshold: 0.7,
    });
    const pool = rows.find((r) => r.feature === "pool")!;
    // Only p1 (0.9) survives; p2 (0.5) is filtered out.
    expect(pool.n).toBe(1);
    expect(pool.medianWith).toBe(1000);
  });
});

describe("pricedPropertyCount", () => {
  it("counts properties that have both a price and a sqft", () => {
    const props: AnalyticsProperty[] = [
      { id: "p1", sold_price: 800_000, list_price: null, sqft: 1000 },
      { id: "p2", sold_price: null, list_price: null, sqft: 1500 },
      { id: "p3", sold_price: 600_000, list_price: null, sqft: null },
    ];
    expect(pricedPropertyCount(props)).toBe(1);
  });
});
