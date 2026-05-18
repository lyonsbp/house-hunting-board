import type { createAdminClient } from "@/lib/supabase/admin";

import type { ListingPreview } from "./types";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Upsert a `properties` row from a parsed listing preview. Idempotent on
 * `(source, source_url)` — re-running is safe and returns the existing
 * row's id without duplicating data.
 *
 * Service-role only: `properties` has no insert policy. Callers (Server
 * Action, REST route, bulk CLI) pass in their own admin client.
 */
export async function upsertPropertyFromPreview(
  admin: AdminClient,
  preview: ListingPreview,
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await admin
    .from("properties")
    .upsert(
      {
        source: preview.property.source,
        source_url: preview.property.sourceUrl,
        source_id: preview.property.sourceId ?? null,
        address: preview.property.address ?? null,
        city: preview.property.city ?? null,
        state: preview.property.state ?? null,
        zip: preview.property.zip ?? null,
        list_price: preview.property.listPrice ?? null,
        sold_price: preview.property.soldPrice ?? null,
        bedrooms: preview.property.bedrooms ?? null,
        bathrooms: preview.property.bathrooms ?? null,
        sqft: preview.property.sqft ?? null,
        lot_sqft: preview.property.lotSqft ?? null,
        year_built: preview.property.yearBuilt ?? null,
        status: preview.property.status ?? null,
        raw: preview.property.raw ?? {},
        scraped_at: preview.scrapedAt,
      },
      { onConflict: "source,source_url" },
    )
    .select("id")
    .single();
  if (error || !data) {
    return { error: error?.message ?? "Failed to save listing record." };
  }
  return { id: data.id as string };
}

/**
 * Insert one current-state snapshot plus one snapshot per event in the
 * listing's own price-history feed. Failures here are non-fatal for the
 * caller — without history we just can't compute deltas later, but the
 * property row + future refreshes still work.
 */
export async function insertSnapshotsFromPreview(
  admin: AdminClient,
  propertyId: string,
  preview: ListingPreview,
): Promise<void> {
  await admin.from("property_snapshots").insert({
    property_id: propertyId,
    list_price: preview.property.listPrice ?? null,
    sold_price: preview.property.soldPrice ?? null,
    status: preview.property.status ?? null,
    scraped_at: preview.scrapedAt,
    source: "scrape",
  });

  const history = preview.property.priceHistory ?? [];
  if (history.length > 0) {
    await admin.from("property_snapshots").insert(
      history.map((h) => ({
        property_id: propertyId,
        list_price: h.listPrice ?? null,
        sold_price: h.soldPrice ?? null,
        status: h.status ?? h.event,
        scraped_at: h.date,
        source: "listing",
      })),
    );
  }
}
