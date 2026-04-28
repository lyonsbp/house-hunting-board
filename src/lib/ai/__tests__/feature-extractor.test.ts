/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extractFeatures, FEATURE_TAXONOMY } from "@/lib/ai/feature-extractor";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function geminiResponse(features: { feature: string; confidence: number }[]): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify({ features }) }],
          },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("extractFeatures", () => {
  it("returns features that match the taxonomy and have valid confidence", async () => {
    fetchMock.mockResolvedValueOnce(
      geminiResponse([
        { feature: "waterfall island", confidence: 0.95 },
        { feature: "pool", confidence: 0.7 },
      ]),
    );

    const out = await extractFeatures({
      address: "123 Maple St",
      raw: { description: "stunning waterfall island, sparkling pool" },
    });

    expect(out).toEqual([
      { feature: "waterfall island", confidence: 0.95 },
      { feature: "pool", confidence: 0.7 },
    ]);
  });

  it("filters out features outside the taxonomy", async () => {
    fetchMock.mockResolvedValueOnce(
      geminiResponse([
        { feature: "waterfall island", confidence: 0.9 },
        { feature: "secret tunnel", confidence: 0.99 },
        { feature: "GRANITE COUNTERS", confidence: 0.8 }, // case mismatch — normalized
      ]),
    );

    const out = await extractFeatures({ raw: {} });
    const names = out.map((f) => f.feature);
    expect(names).toContain("waterfall island");
    expect(names).toContain("granite counters"); // lower-cased
    expect(names).not.toContain("secret tunnel");
  });

  it("drops features with out-of-range confidence", async () => {
    fetchMock.mockResolvedValueOnce(
      geminiResponse([
        { feature: "pool", confidence: 1.4 },
        { feature: "deck", confidence: -0.2 },
        { feature: "patio", confidence: 0.55 },
      ]),
    );

    const out = await extractFeatures({ raw: {} });
    expect(out).toEqual([{ feature: "patio", confidence: 0.55 }]);
  });

  it("dedupes by feature, keeping the highest confidence", async () => {
    fetchMock.mockResolvedValueOnce(
      geminiResponse([
        { feature: "pool", confidence: 0.4 },
        { feature: "pool", confidence: 0.9 },
      ]),
    );

    const out = await extractFeatures({ raw: {} });
    expect(out).toEqual([{ feature: "pool", confidence: 0.9 }]);
  });

  it("returns [] when the model returns an empty list", async () => {
    fetchMock.mockResolvedValueOnce(geminiResponse([]));
    const out = await extractFeatures({ raw: { description: "barren lot" } });
    expect(out).toEqual([]);
  });

  it("throws when the API errors", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("rate limited", { status: 429 }),
    );
    await expect(extractFeatures({ raw: {} })).rejects.toThrow(/429/);
  });

  it("requires GEMINI_API_KEY", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(extractFeatures({ raw: {} })).rejects.toThrow(
      /GEMINI_API_KEY/,
    );
  });

  it("declares enough features to be useful", () => {
    expect(FEATURE_TAXONOMY.length).toBeGreaterThan(30);
  });

  it("recurses into Redfin's JSON-encoded string sub-payloads", async () => {
    // This is the actual shape Redfin's parser saves into properties.raw —
    // listingRemarks lives several levels deep, inside a JSON-encoded
    // string at `ReactServerAgent.cache.dataCache.<url>.res.text`, with a
    // `}&&{...}` anti-hijacking prefix.
    const innerPayload = JSON.stringify({
      payload: {
        listingRemarks: "Open kitchen with a beautiful waterfall island.",
        addressSectionInfo: { beds: 3, baths: 2 },
      },
    });
    const redfinStyleRaw = {
      ReactServerAgent: {
        cache: {
          dataCache: {
            "/stingray/api/x": {
              res: { _hasBody: true, text: `{}&&${innerPayload}` },
            },
          },
        },
      },
    };

    fetchMock.mockImplementationOnce(async (_url, init) => {
      const body = JSON.parse(
        (init as { body: string }).body,
      ) as { contents: { parts: { text: string }[] }[] };
      const promptText = body.contents[0].parts[0].text;
      // The deeply nested keys must reach the prompt or the model has
      // nothing to extract from.
      expect(promptText).toContain("listingRemarks");
      expect(promptText).toContain("waterfall island");
      return geminiResponse([{ feature: "waterfall island", confidence: 0.9 }]);
    });

    const out = await extractFeatures({ raw: redfinStyleRaw });
    expect(out).toEqual([{ feature: "waterfall island", confidence: 0.9 }]);
  });

  it("preserves Redfin-shaped fields (listingRemarks + amenityEntries) in the prompt", async () => {
    fetchMock.mockImplementationOnce(async (_url, init) => {
      // Inspect what got sent so we can assert the Redfin keys aren't stripped.
      const body = JSON.parse(
        (init as { body: string }).body,
      ) as { contents: { parts: { text: string }[] }[] };
      const promptText = body.contents[0].parts[0].text;
      // The trimmed payload is embedded in the prompt as JSON. Both keys
      // should survive the trim.
      expect(promptText).toContain("listingRemarks");
      expect(promptText).toContain("amenityEntries");
      expect(promptText).toContain("waterfall island"); // value present in our raw
      return geminiResponse([{ feature: "waterfall island", confidence: 0.9 }]);
    });

    const redfinShapedRaw = {
      addressSectionInfo: {
        beds: 3,
        baths: 2,
        latLong: { latitude: 33.6, longitude: -117.9 },
      },
      mediaBrowserInfo: { photos: [] },
      // Redfin nests the marketing copy and amenities here:
      propertyInfo: {
        listingRemarks:
          "Stunning open kitchen with waterfall island and pool with tanning ledge.",
        marketingRemarks: "Recently remodeled.",
        amenityEntries: [
          {
            amenityName: "Pool",
            amenityValues: ["In-Ground"],
          },
        ],
      },
    };

    const out = await extractFeatures({
      address: "123 Maple St",
      raw: redfinShapedRaw,
    });
    expect(out).toEqual([{ feature: "waterfall island", confidence: 0.9 }]);
  });
});
