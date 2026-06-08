import { describe, expect, it } from "vitest";

import { getFetcher } from "@/lib/listings/registry";
import { UnsupportedListingError } from "@/lib/listings/types";

describe("getFetcher", () => {
  it("matches www.redfin.com", () => {
    expect(getFetcher("https://www.redfin.com/WA/Seattle/123-Main/home/1").source).toBe(
      "redfin",
    );
  });

  it("matches the bare redfin.com host", () => {
    expect(getFetcher("https://redfin.com/foo").source).toBe("redfin");
  });

  it("matches redf.in short links", () => {
    expect(getFetcher("https://redf.in/aBcDeF").source).toBe("redfin");
  });

  it("matches www.redf.in short links", () => {
    expect(getFetcher("https://www.redf.in/aBcDeF").source).toBe("redfin");
  });

  it("matches www.zillow.com", () => {
    expect(getFetcher("https://www.zillow.com/homedetails/x/1_zpid/").source).toBe(
      "zillow",
    );
  });

  it("matches mixed-case zillow hosts", () => {
    expect(getFetcher("https://WWW.ZILLOW.COM/homedetails/x/1_zpid/").source).toBe(
      "zillow",
    );
  });

  it("throws UnsupportedListingError for unknown domains", () => {
    expect(() => getFetcher("https://example.com/listing")).toThrowError(
      UnsupportedListingError,
    );
  });

  it("rejects malformed URLs as unsupported", () => {
    expect(() => getFetcher("not-a-url")).toThrowError(UnsupportedListingError);
  });
});
