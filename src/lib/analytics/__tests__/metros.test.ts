import { describe, expect, it } from "vitest";

import { listMetroNames, METROS, metroForZip } from "@/lib/analytics/metros";

describe("metroForZip", () => {
  it("maps a Newport Beach ZIP to LA-Long Beach-Anaheim", () => {
    expect(metroForZip("92663")).toBe(
      "Los Angeles-Long Beach-Anaheim, CA",
    );
  });

  it("maps a midtown Manhattan ZIP to NY-Newark-Jersey City", () => {
    expect(metroForZip("10018")).toBe(
      "New York-Newark-Jersey City, NY-NJ-PA",
    );
  });

  it("maps a Boston ZIP to Boston-Cambridge-Newton", () => {
    expect(metroForZip("02114")).toBe("Boston-Cambridge-Newton, MA-NH");
  });

  it("maps a Seattle ZIP to Seattle-Tacoma-Bellevue", () => {
    expect(metroForZip("98101")).toBe("Seattle-Tacoma-Bellevue, WA");
  });

  it("maps a downtown San Francisco ZIP to SF-Oakland-Berkeley", () => {
    expect(metroForZip("94103")).toBe(
      "San Francisco-Oakland-Berkeley, CA",
    );
  });

  it("returns null for ZIPs outside the top metros", () => {
    // 593 is rural Montana — not in our top-40 list.
    expect(metroForZip("59301")).toBeNull();
  });

  it("returns null for missing or empty ZIPs", () => {
    expect(metroForZip(null)).toBeNull();
    expect(metroForZip(undefined)).toBeNull();
    expect(metroForZip("")).toBeNull();
    expect(metroForZip("  ")).toBeNull();
  });

  it("returns null for non-numeric or too-short ZIPs", () => {
    expect(metroForZip("ab")).toBeNull();
    expect(metroForZip("12")).toBeNull();
    expect(metroForZip("abcde")).toBeNull();
  });

  it("trims whitespace before lookup", () => {
    expect(metroForZip(" 92663 ")).toBe(
      "Los Angeles-Long Beach-Anaheim, CA",
    );
  });
});

describe("listMetroNames", () => {
  it("returns names sorted alphabetically", () => {
    const names = listMetroNames();
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it("matches the METROS table length", () => {
    expect(listMetroNames().length).toBe(METROS.length);
  });
});
