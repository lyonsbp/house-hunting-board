import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseRedfin } from "@/lib/listings/parsers/redfin";

const FIXTURE_DIR = join(__dirname, "__fixtures__");
function load(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf-8");
}

const SOURCE_URL = "https://www.redfin.com/WA/Seattle/123-Maple-St-98101/home/12345";

describe("parseRedfin", () => {
  it("extracts the embedded React state pathway when available", () => {
    const out = parseRedfin(load("redfin-embedded.html"), SOURCE_URL);

    expect(out.pathway).toBe("embedded-json");
    expect(out.partial).toBe(false);
    expect(out.images.length).toBe(3);
    expect(out.images[0].url).toBe("https://ssl.cdn-redfin.com/photo/1.jpg");
    expect(out.property).toMatchObject({
      source: "redfin",
      sourceUrl: SOURCE_URL,
      address: "123 Maple St",
      city: "Seattle",
      state: "WA",
      zip: "98101",
      bedrooms: 3,
      bathrooms: 2.5,
      sqft: 1850,
      yearBuilt: 1972,
      listPrice: 875000,
      sourceId: "PR-123",
      status: "Active",
    });
  });

  it("falls back to JSON-LD when there is no embedded React state", () => {
    const out = parseRedfin(load("redfin-jsonld.html"), SOURCE_URL);

    expect(out.pathway).toBe("json-ld");
    expect(out.partial).toBe(false);
    expect(out.images.map((i) => i.url)).toEqual([
      "https://ssl.cdn-redfin.com/photo/jsonld-1.jpg",
      "https://ssl.cdn-redfin.com/photo/jsonld-2.jpg",
    ]);
    expect(out.property).toMatchObject({
      source: "redfin",
      address: "456 Cedar Ln",
      city: "Bellevue",
      state: "WA",
      zip: "98004",
      bedrooms: 4,
      bathrooms: 3,
      yearBuilt: 1998,
      listPrice: 1200000,
    });
  });

  it("falls back to OG tags as a last resort and marks the preview partial", () => {
    const out = parseRedfin(load("redfin-og.html"), SOURCE_URL);

    expect(out.pathway).toBe("og-tags");
    expect(out.partial).toBe(true);
    expect(out.images).toEqual([
      { url: "https://ssl.cdn-redfin.com/photo/only-og.jpg" },
    ]);
    expect(out.property.address).toBe("789 Birch Way");
  });

  it("throws when no pathway resolves", () => {
    expect(() => parseRedfin("<html><body>nothing</body></html>", SOURCE_URL)).toThrow(
      /Could not extract a Redfin listing/i,
    );
  });
});
