/**
 * LLM feature-signal extractor for imported listings (PRD §5.4).
 *
 * Given a `properties` row (address + raw scraped payload), pick which of
 * a curated taxonomy of ~40 features the listing evidences. Output rows
 * land in `feature_signals` with `source='llm-extract'` and feed the
 * eventual price-analytics queries in M5.
 *
 * Closed taxonomy (vs. open vocabulary) so cohort comparisons stay clean
 * — "waterfall island" must always mean the same thing across listings.
 */

const TEXT_MODEL_DEFAULT = "gemini-2.5-flash";
const ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const REQUEST_TIMEOUT_MS = 30_000;

export const FEATURE_TAXONOMY: readonly string[] = [
  // Kitchen
  "open kitchen",
  "kitchen island",
  "waterfall island",
  "butler pantry",
  "stainless appliances",
  "professional range",
  "marble counters",
  "granite counters",
  "quartz counters",
  "double oven",

  // Primary suite / baths
  "primary suite",
  "walk-in closet",
  "double vanity",
  "soaking tub",
  "steam shower",
  "heated floors",

  // Outdoor
  "pool",
  "hot tub",
  "outdoor kitchen",
  "deck",
  "patio",
  "fire pit",
  "tanning ledge",
  "covered porch",
  "fenced yard",
  "mature landscaping",

  // Structure / interior
  "ADU",
  "finished basement",
  "vaulted ceilings",
  "exposed beams",
  "open floor plan",
  "fireplace",
  "bay window",
  "skylights",
  "hardwood floors",

  // Systems
  "smart home",
  "solar panels",
  "ev charger",
  "central air",
  "tankless water heater",
  "new roof",

  // Garage / parking
  "attached garage",
  "detached garage",
  "rv parking",
] as const;

export type ExtractedFeature = {
  feature: string;
  confidence: number;
};

export type ExtractInput = {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  /** Full scraped payload — `properties.raw`. */
  raw?: unknown;
};

/**
 * Run the extractor against a single property. Returns features whose
 * names appear verbatim in `FEATURE_TAXONOMY` and whose confidence is in
 * [0, 1]. Anything outside the taxonomy is silently dropped — we trust
 * the schema enforcement but defend in code so a hallucinated feature
 * doesn't pollute the analytics dataset.
 */
export async function extractFeatures(
  input: ExtractInput,
): Promise<ExtractedFeature[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const modelName = process.env.GEMINI_TEXT_MODEL ?? TEXT_MODEL_DEFAULT;

  const taxonomyList = FEATURE_TAXONOMY.join(", ");
  const propertyText = JSON.stringify(
    {
      address: input.address ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      raw: trimRaw(input.raw),
    },
    null,
    2,
  );

  const prompt = [
    "You are extracting structured features from a real-estate listing for a search/analytics dataset.",
    "",
    "Pick which of the listed features are clearly evidenced in the listing data.",
    "Skip anything that isn't clearly mentioned. Don't invent features.",
    "Confidence is 0..1 where 1 = explicitly described in the listing copy or",
    "structured fields, 0.5 = strongly implied, <0.4 = weak signal (skip).",
    "",
    `Allowed features (use the exact strings, lower-case): ${taxonomyList}`,
    "",
    "Listing data:",
    propertyText,
  ].join("\n");

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          features: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                feature: { type: "STRING" },
                confidence: { type: "NUMBER" },
              },
              required: ["feature", "confidence"],
            },
          },
        },
        required: ["features"],
      },
    },
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(
      `${ENDPOINT_BASE}/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  } catch (cause) {
    clearTimeout(timer);
    if (cause instanceof Error && cause.name === "AbortError") {
      throw new Error("Gemini extraction request timed out");
    }
    throw cause;
  }
  clearTimeout(timer);

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Gemini ${modelName} returned ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
    );
  }

  const json = (await res.json()) as GeminiResponse;
  const text = json.candidates?.[0]?.content?.parts?.find((p) =>
    typeof (p as { text?: unknown }).text === "string",
  ) as { text: string } | undefined;
  if (!text?.text) throw new Error("Gemini extraction returned no JSON text");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.text);
  } catch {
    throw new Error("Gemini extraction returned non-JSON output");
  }

  const taxonomySet = new Set<string>(FEATURE_TAXONOMY);
  const items = (parsed as { features?: unknown }).features;
  if (!Array.isArray(items)) return [];

  const out: ExtractedFeature[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const f = (item as { feature?: unknown }).feature;
    const c = (item as { confidence?: unknown }).confidence;
    if (typeof f !== "string" || typeof c !== "number") continue;
    const name = f.trim().toLowerCase();
    if (!taxonomySet.has(name)) continue;
    if (c < 0 || c > 1 || Number.isNaN(c)) continue;
    out.push({ feature: name, confidence: Math.round(c * 100) / 100 });
  }
  return dedupe(out);
}

/**
 * The full vendor `raw` payload can be 600KB+. Trim noise so the prompt
 * stays small (~$0.001/extract) and the model focuses on description text.
 */
function trimRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw ?? null;
  const out: Record<string, unknown> = {};
  // Keys we keep across all sources. Mixed casing covers Zillow's
  // (`description`, `homeFacts`) and Redfin's distinct shape
  // (`listingRemarks`, `amenityEntries`/`amenityName`/`amenityValues`).
  // Without the Redfin-specific keys the marketing copy + structured
  // amenities get stripped and the LLM has nothing to work with.
  const KEEP_KEYS = new Set([
    // Generic / Zillow
    "description",
    "publicRemarks",
    "remarks",
    "marketingDescription",
    "amenities",
    "features",
    "interiorFeatures",
    "exteriorFeatures",
    "appliances",
    "lotFeatures",
    "view",
    "parking",
    "heating",
    "cooling",
    "flooring",
    "rooms",
    "yearBuilt",
    "lotSize",
    "sqFt",
    "beds",
    "baths",
    "garage",
    // Redfin
    "listingRemarks",
    "marketingRemarks",
    "amenitiesInfo",
    "amenityGroups",
    "amenityEntries",
    "amenityName",
    "amenityValues",
    "referenceName",
  ]);
  walk(raw, "", out, KEEP_KEYS, 0);
  return out;
}

function walk(
  value: unknown,
  path: string,
  out: Record<string, unknown>,
  keep: Set<string>,
  depth: number,
): void {
  if (depth > 12) return;
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    // Redfin's `properties.raw` blob contains nested JSON-encoded strings
    // (e.g. `ReactServerAgent.cache.dataCache.<url>.res.text` is a string
    // whose body is the actual property payload). Without recursing into
    // those, walk never sees `listingRemarks` / `amenityEntries` and the
    // LLM gets nothing useful for Redfin imports. Defend against the
    // `}&&{` anti-hijacking prefix Redfin uses on stingray API responses.
    const trimmed = stripJsonPrefix(value.trim());
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        walk(JSON.parse(trimmed), path, out, keep, depth + 1);
      } catch {
        // Not parseable JSON — ignore.
      }
    }
    return;
  }
  if (typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const v of value) walk(v, path, out, keep, depth + 1);
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (keep.has(k)) {
      out[k] = v;
      continue;
    }
    walk(v, k, out, keep, depth + 1);
  }
}

function stripJsonPrefix(s: string): string {
  if (s.startsWith("{}&&")) return s.slice(4);
  if (s.startsWith("&&")) return s.slice(2);
  return s;
}

function dedupe(items: ExtractedFeature[]): ExtractedFeature[] {
  const byName = new Map<string, ExtractedFeature>();
  for (const item of items) {
    const existing = byName.get(item.feature);
    if (!existing || item.confidence > existing.confidence) {
      byName.set(item.feature, item);
    }
  }
  return [...byName.values()].sort((a, b) => b.confidence - a.confidence);
}

type GeminiResponse = {
  candidates?: {
    content?: { parts?: { text?: string }[] };
  }[];
};
