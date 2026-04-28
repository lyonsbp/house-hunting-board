"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { extractFeatures } from "@/lib/ai/feature-extractor";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Run the LLM feature extractor for one property and replace its
 * 'llm-extract' rows in `feature_signals`. Always uses the admin client
 * because `feature_signals` is server-only-write per RLS.
 *
 * Auth boundary: the caller must already be a member of a board that has
 * an artifact linked to this property. Verified via the user-scoped
 * client before we run the extractor (which costs money).
 */
export async function extractFeaturesForProperty(
  propertyId: string,
): Promise<{ ok: true; written: number } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = z.string().uuid().safeParse(propertyId);
  if (!parsed.success) return { error: "Invalid property id." };

  const supabase = await createClient();
  // Membership check: does this property link to an artifact on a board
  // the caller is a member of? RLS on `property_artifacts` already gates
  // SELECT on board membership, so an empty result = not authorized.
  const { data: linkRow } = await supabase
    .from("property_artifacts")
    .select("artifact_id, artifacts!inner(board_id)")
    .eq("property_id", parsed.data)
    .limit(1)
    .maybeSingle();
  if (!linkRow) return { error: "Not authorized for this property." };
  const artifactJoin = (linkRow as unknown as {
    artifacts: { board_id: string } | { board_id: string }[];
  }).artifacts;
  const boardId = (Array.isArray(artifactJoin) ? artifactJoin[0] : artifactJoin)
    ?.board_id;

  return await runExtraction(parsed.data, boardId);
}

/**
 * Internal: run the extractor without the auth check. Called by
 * commitListingImport right after a property upsert (we already
 * authorized the user there) and by `extractFeaturesForProperty`.
 */
export async function runExtraction(
  propertyId: string,
  revalidateBoardId?: string | null,
): Promise<{ ok: true; written: number } | { error: string }> {
  const admin = createAdminClient();

  const { data: property, error: pErr } = await admin
    .from("properties")
    .select("address, city, state, raw")
    .eq("id", propertyId)
    .maybeSingle();
  if (pErr) return { error: pErr.message };
  if (!property) return { error: "Property not found." };

  let features;
  try {
    features = await extractFeatures({
      address: property.address,
      city: property.city,
      state: property.state,
      raw: property.raw,
    });
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Feature extraction failed.",
    };
  }

  // Replace any prior LLM-extracted rows. Manual rows ('manual', or other
  // sources we add later) are left alone so a human curation isn't blown
  // away by re-extracting.
  await admin
    .from("feature_signals")
    .delete()
    .eq("property_id", propertyId)
    .eq("source", "llm-extract");

  if (features.length > 0) {
    const { error: insertErr } = await admin.from("feature_signals").insert(
      features.map((f) => ({
        property_id: propertyId,
        feature: f.feature,
        source: "llm-extract",
        confidence: f.confidence,
      })),
    );
    if (insertErr) return { error: insertErr.message };
  }

  if (revalidateBoardId) {
    revalidatePath(`/boards/${revalidateBoardId}`);
  }
  return { ok: true, written: features.length };
}
