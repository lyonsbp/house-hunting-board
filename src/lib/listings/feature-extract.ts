import { extractFeatures } from "@/lib/ai/feature-extractor";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Run the LLM feature extractor for one property and replace its
 * 'llm-extract' rows in `feature_signals`. Uses the service-role admin
 * client because `feature_signals` is server-only-write per RLS.
 *
 * No Next-specific imports here so non-Next callers (e.g. the bulk-import
 * CLI script) can use it. The Server Action wrapper in
 * `feature-actions.ts` handles `revalidatePath` after this returns.
 */
export async function runExtraction(
  propertyId: string,
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

  return { ok: true, written: features.length };
}
