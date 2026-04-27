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
  it("extracts the modern Redfin shape (mediaBrowserInfo.photos + addressSectionInfo)", () => {
    const out = parseRedfin(load("redfin-embedded.html"), SOURCE_URL);

    expect(out.pathway).toBe("embedded-json");
    expect(out.partial).toBe(false);
    // Three carousel photos in the fixture, all from Redfin's CDN.
    expect(out.images.length).toBe(3);
    expect(out.images[0].url).toBe(
      "https://ssl.cdn-redfin.com/photo/45/bigphoto/552/PW21087552_0.jpg",
    );
    expect(out.property).toMatchObject({
      source: "redfin",
      sourceUrl: SOURCE_URL,
      address: "2661 Crestview Dr",
      city: "Newport Beach",
      state: "CA",
      zip: "92663",
      bedrooms: 3,
      bathrooms: 2,
      sqft: 1654,
      yearBuilt: 1952,
      // Sold listing — headline number is the sold price, not list price.
      soldPrice: 2700000,
      lotSqft: 4800,
    });
    // Status flags this as sold so we don't show a stale list price.
    expect(out.property.listPrice).toBeUndefined();
    expect(out.property.status?.toLowerCase()).toMatch(/sold|closed/);
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
