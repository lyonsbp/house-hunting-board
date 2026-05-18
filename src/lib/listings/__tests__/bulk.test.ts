import { describe, expect, it, vi } from "vitest";

import {
  insertSnapshotsFromPreview,
  upsertPropertyFromPreview,
} from "@/lib/listings/bulk";
import type { ListingPreview } from "@/lib/listings/types";

function makePreview(over: Partial<ListingPreview["property"]> = {}): ListingPreview {
  return {
    property: {
      source: "redfin",
      sourceUrl: "https://www.redfin.com/WA/Seattle/123-Main/home/42",
      sourceId: "42",
      address: "123 Main St",
      city: "Seattle",
      state: "WA",
      zip: "98101",
      listPrice: 750_000,
      soldPrice: 740_000,
      bedrooms: 3,
      bathrooms: 2,
      sqft: 1800,
      lotSqft: 4500,
      yearBuilt: 1920,
      status: "Sold",
      priceHistory: [
        {
          date: "2024-01-15T00:00:00Z",
          event: "Listed for sale",
          listPrice: 760_000,
          status: "Active",
        },
        {
          date: "2024-02-10T00:00:00Z",
          event: "Sold",
          soldPrice: 740_000,
          status: "Sold",
        },
      ],
      raw: { stub: true },
      ...over,
    },
    images: [],
    pathway: "embedded-json",
    partial: false,
    scrapedAt: "2024-03-01T00:00:00Z",
  };
}

/**
 * Tiny fake `SupabaseClient` that records the upsert payload + onConflict
 * passed in. We only need the surface the helpers actually use.
 */
function makeFakeAdmin() {
  const calls: Array<{
    table: string;
    op: "upsert" | "insert";
    payload: unknown;
    options?: unknown;
  }> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = {
    from(table: string) {
      return {
        upsert(payload: unknown, options?: unknown) {
          calls.push({ table, op: "upsert", payload, options });
          return {
            select: () => ({
              single: async () => ({
                data: { id: "00000000-0000-0000-0000-000000000001" },
                error: null,
              }),
            }),
          };
        },
        insert(payload: unknown) {
          calls.push({ table, op: "insert", payload });
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
  return { admin, calls };
}

describe("upsertPropertyFromPreview", () => {
  it("maps every preview field to the corresponding DB column", async () => {
    const { admin, calls } = makeFakeAdmin();
    const result = await upsertPropertyFromPreview(admin, makePreview());

    expect(result).toEqual({ id: "00000000-0000-0000-0000-000000000001" });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.table).toBe("properties");
    expect(call.op).toBe("upsert");
    expect(call.options).toEqual({ onConflict: "source,source_url" });
    expect(call.payload).toEqual({
      source: "redfin",
      source_url: "https://www.redfin.com/WA/Seattle/123-Main/home/42",
      source_id: "42",
      address: "123 Main St",
      city: "Seattle",
      state: "WA",
      zip: "98101",
      list_price: 750_000,
      sold_price: 740_000,
      bedrooms: 3,
      bathrooms: 2,
      sqft: 1800,
      lot_sqft: 4500,
      year_built: 1920,
      status: "Sold",
      raw: { stub: true },
      scraped_at: "2024-03-01T00:00:00Z",
    });
  });

  it("substitutes nulls for missing optional fields", async () => {
    const { admin, calls } = makeFakeAdmin();
    await upsertPropertyFromPreview(
      admin,
      makePreview({
        sourceId: undefined,
        address: undefined,
        listPrice: undefined,
        bedrooms: undefined,
        raw: undefined,
      }),
    );
    const payload = calls[0]!.payload as Record<string, unknown>;
    expect(payload.source_id).toBeNull();
    expect(payload.address).toBeNull();
    expect(payload.list_price).toBeNull();
    expect(payload.bedrooms).toBeNull();
    // raw defaults to an empty object, not null, so the JSONB column is
    // always well-formed.
    expect(payload.raw).toEqual({});
  });

  it("returns { error } when the upsert fails", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin: any = {
      from() {
        return {
          upsert() {
            return {
              select: () => ({
                single: async () => ({
                  data: null,
                  error: { message: "boom" },
                }),
              }),
            };
          },
        };
      },
    };
    const result = await upsertPropertyFromPreview(admin, makePreview());
    expect(result).toEqual({ error: "boom" });
  });
});

describe("insertSnapshotsFromPreview", () => {
  it("inserts a current-state snapshot + one row per history event", async () => {
    const { admin, calls } = makeFakeAdmin();
    await insertSnapshotsFromPreview(admin, "prop-1", makePreview());

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      table: "property_snapshots",
      op: "insert",
      payload: {
        property_id: "prop-1",
        list_price: 750_000,
        sold_price: 740_000,
        status: "Sold",
        scraped_at: "2024-03-01T00:00:00Z",
        source: "scrape",
      },
    });
    expect(calls[1]?.table).toBe("property_snapshots");
    expect(calls[1]?.payload).toEqual([
      {
        property_id: "prop-1",
        list_price: 760_000,
        sold_price: null,
        status: "Active",
        scraped_at: "2024-01-15T00:00:00Z",
        source: "listing",
      },
      {
        property_id: "prop-1",
        list_price: null,
        sold_price: 740_000,
        status: "Sold",
        scraped_at: "2024-02-10T00:00:00Z",
        source: "listing",
      },
    ]);
  });

  it("skips the history insert when there are no events", async () => {
    const { admin, calls } = makeFakeAdmin();
    await insertSnapshotsFromPreview(
      admin,
      "prop-1",
      makePreview({ priceHistory: [] }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.table).toBe("property_snapshots");
  });

  it("falls back to event label when status is missing on a history row", async () => {
    const { admin, calls } = makeFakeAdmin();
    await insertSnapshotsFromPreview(
      admin,
      "prop-1",
      makePreview({
        priceHistory: [
          { date: "2024-01-15T00:00:00Z", event: "Price change", listPrice: 700_000 },
        ],
      }),
    );
    const historyPayload = calls[1]!.payload as Array<{ status: string }>;
    expect(historyPayload[0]?.status).toBe("Price change");
  });
});

// Silence unused-var lint on vi (kept around in case we need spies later).
void vi;
