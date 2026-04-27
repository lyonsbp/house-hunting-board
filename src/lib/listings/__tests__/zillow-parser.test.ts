import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseZillow } from "@/lib/listings/parsers/zillow";

const FIXTURE_DIR = join(__dirname, "__fixtures__");
function load(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf-8");
}

const SOURCE_URL = "https://www.zillow.com/homedetails/42-Oak-Ave/111_zpid/";

describe("parseZillow", () => {
  it("extracts the __NEXT_DATA__ pathway when present and picks the highest-resolution photo", () => {
    const out = parseZillow(load("zillow-nextdata.html"), SOURCE_URL);

    expect(out.pathway).toBe("embedded-json");
    expect(out.partial).toBe(false);
    expect(out.images.map((i) => i.url)).toEqual([
      "https://photos.zillowstatic.com/p/large.jpg",
      "https://photos.zillowstatic.com/p/two-large.jpg",
    ]);
    expect(out.property).toMatchObject({
      source: "zillow",
      sourceId: "111",
      address: "42 Oak Ave",
      city: "Portland",
      state: "OR",
      zip: "97201",
      bedrooms: 3,
      bathrooms: 2,
      sqft: 1600,
      yearBuilt: 1985,
      listPrice: 650000,
      status: "FOR_SALE",
    });
  });

  it("falls back to JSON-LD when __NEXT_DATA__ is absent", () => {
    const out = parseZillow(load("zillow-jsonld.html"), SOURCE_URL);

    expect(out.pathway).toBe("json-ld");
    expect(out.partial).toBe(false);
    expect(out.images.map((i) => i.url)).toEqual([
      "https://photos.zillowstatic.com/p/jsonld-a.jpg",
      "https://photos.zillowstatic.com/p/jsonld-b.jpg",
    ]);
    expect(out.property).toMatchObject({
      source: "zillow",
      address: "9 Pine Court",
      city: "Austin",
      state: "TX",
      zip: "78701",
      bedrooms: 2,
      bathrooms: 1,
    });
  });

  it("falls back to OG tags and marks the preview partial", () => {
    const out = parseZillow(load("zillow-og.html"), SOURCE_URL);

    expect(out.pathway).toBe("og-tags");
    expect(out.partial).toBe(true);
    expect(out.images).toEqual([
      { url: "https://photos.zillowstatic.com/p/only-og.jpg" },
    ]);
  });

  it("throws when no pathway resolves", () => {
    expect(() => parseZillow("<html></html>", SOURCE_URL)).toThrow(
      /Could not extract a Zillow listing/i,
    );
  });
});
