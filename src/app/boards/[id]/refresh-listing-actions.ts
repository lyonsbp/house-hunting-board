"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import {
  getDailyRefreshLimit,
  isSuperadminEmail,
  startOfTodayUtc,
} from "@/lib/listings/quota";
import { getFetcher } from "@/lib/listings/registry";
import {
  ListingFetchError,
  UnsupportedListingError,
  type ListingPreview,
} from "@/lib/listings/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const RefreshSchema = z.object({
  propertyId: z.string().uuid(),
});

export type RefreshResult =
  | {
      ok: true;
      listPriceChanged: boolean;
      soldPriceChanged: boolean;
      statusChanged: boolean;
      previousStatus: string | null;
      newStatus: string | null;
    }
  | { error: string };

/**
 * Re-scrape an already-imported property and capture the fresh values.
 *
 * Flow:
 *   1. Auth + membership gate (must be linked to a board the user is on).
 *   2. Quota gate against `listing_scrapes` rows tagged `status='refresh'`,
 *      separate from the import quota so refresh-spam can't burn it.
 *   3. Re-run the same fetcher+parser pipeline used at import time.
 *   4. Insert a `property_snapshots` row with the fresh values (audit log).
 *   5. Upsert the live `properties` row to make those values canonical.
 *   6. Log a `listing_scrapes` row tagged `status='refresh'` for quota counting.
 *
 * Feature re-extraction is intentionally NOT triggered automatically —
 * costs Gemini quota for an arguable benefit. Users can hit "Re-extract"
 * separately if the listing description changed enough to matter.
 */
export async function refreshListing(input: {
  propertyId: string;
}): Promise<RefreshResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = RefreshSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid property id." };

  const supabase = await createClient();

  // Membership: the property must link to an artifact on a board the
  // caller is a member of. RLS on `property_artifacts` already gates
  // SELECT to board members, so an empty result = unauthorized.
  const { data: linkRow } = await supabase
    .from("property_artifacts")
    .select("artifact_id, artifacts!inner(board_id)")
    .eq("property_id", parsed.data.propertyId)
    .limit(1)
    .maybeSingle();
  if (!linkRow) return { error: "Not authorized for this property." };
  const artifactJoin = (linkRow as unknown as {
    artifacts: { board_id: string } | { board_id: string }[];
  }).artifacts;
  const boardId = (Array.isArray(artifactJoin) ? artifactJoin[0] : artifactJoin)
    ?.board_id;

  // Refresh-only quota gate (separate counter from imports).
  const exempt = isSuperadminEmail(
    typeof user.email === "string" ? user.email : null,
  );
  if (!exempt) {
    const limit = getDailyRefreshLimit();
    const { count } = await supabase
      .from("listing_scrapes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.sub)
      .eq("status", "refresh")
      .gte("created_at", startOfTodayUtc());
    if ((count ?? 0) >= limit) {
      return {
        error: `Daily refresh limit reached (${limit}/day). Try again tomorrow.`,
      };
    }
  }

  // Look up the property's current state so we can both populate the
  // fetcher's URL and compute change-flags after the refresh.
  const admin = createAdminClient();
  const { data: property, error: pErr } = await admin
    .from("properties")
    .select(
      "id, source, source_url, list_price, sold_price, status, address, city, state, zip, scraped_at",
    )
    .eq("id", parsed.data.propertyId)
    .maybeSingle();
  if (pErr) return { error: pErr.message };
  if (!property) return { error: "Property not found." };

  let fetcher;
  try {
    fetcher = getFetcher(property.source_url);
  } catch (e) {
    if (e instanceof UnsupportedListingError) {
      return { error: `${e.host} isn't supported anymore — can't refresh.` };
    }
    throw e;
  }

  // Log the scrape attempt before the (possibly billable) fetcher call so
  // a hot-loop of failed refreshes still counts against the quota.
  await supabase.from("listing_scrapes").insert({
    user_id: user.sub,
    source: fetcher.source,
    source_url: property.source_url,
    status: "refresh",
  });

  let preview: ListingPreview;
  try {
    preview = await fetcher.fetchAndParse(property.source_url);
  } catch (e) {
    if (e instanceof ListingFetchError) {
      return { error: `Refresh failed: ${e.message}` };
    }
    return {
      error: e instanceof Error ? e.message : "Refresh failed.",
    };
  }

  const newListPrice = preview.property.listPrice ?? null;
  const newSoldPrice = preview.property.soldPrice ?? null;
  const newStatus = preview.property.status ?? null;

  // Audit row first — never let a failed `properties` upsert lose the
  // historical state we just observed.
  await admin.from("property_snapshots").insert({
    property_id: property.id,
    list_price: newListPrice,
    sold_price: newSoldPrice,
    status: newStatus,
    scraped_at: preview.scrapedAt,
  });

  // Update the canonical `properties` row. We don't blindly upsert all
  // fields — the user may have manually corrected things, so we only
  // touch the values that the source actually owns: price, status,
  // raw payload, and scraped_at.
  const { error: updateErr } = await admin
    .from("properties")
    .update({
      list_price: newListPrice,
      sold_price: newSoldPrice,
      status: newStatus,
      raw: preview.property.raw ?? property,
      scraped_at: preview.scrapedAt,
    })
    .eq("id", property.id);
  if (updateErr) return { error: updateErr.message };

  if (boardId) revalidatePath(`/boards/${boardId}`);

  return {
    ok: true,
    listPriceChanged: (property.list_price ?? null) !== newListPrice,
    soldPriceChanged: (property.sold_price ?? null) !== newSoldPrice,
    statusChanged: (property.status ?? null) !== newStatus,
    previousStatus: property.status ?? null,
    newStatus,
  };
}
