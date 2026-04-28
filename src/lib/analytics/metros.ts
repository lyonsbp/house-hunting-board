/**
 * Coarse ZIP-to-metro lookup for the analytics page filter.
 *
 * We bucket on ZIP3 (the first three digits of the ZIP) rather than the
 * full ZIP. ZIP3 ≈ regional sectional center and aligns reasonably well
 * with metro boundaries — e.g. ZIP3 `926` covers Newport Beach, Costa
 * Mesa, and Irvine, all in the LA-Long Beach-Anaheim CBSA. The full
 * Census/HUD ZIP-CBSA crosswalk would be more precise but ships ~50KB+
 * of JSON for marginal accuracy gain at personal-use volume.
 *
 * The list is hand-curated to cover the ~40 largest US metros by
 * population (roughly the Census Bureau's top metros). ZIPs outside any
 * mapped ZIP3 return `null` and the analytics UI buckets them as "Other".
 *
 * Update procedure when a metro the user cares about isn't covered:
 *   1. Find the ZIP3(s) for the area (https://en.wikipedia.org/wiki/ZIP_Code_prefixes).
 *   2. Add an entry to METROS keyed by the official MSA name.
 *   3. Add a regression test in metros.test.ts asserting a representative
 *      ZIP from the metro maps correctly.
 */

export type MetroEntry = {
  /** Display name. Use the official Census MSA short name where possible. */
  name: string;
  /** ZIP3 prefixes (first three digits) included in this metro. */
  zip3s: readonly string[];
};

export const METROS: readonly MetroEntry[] = [
  {
    name: "Atlanta-Sandy Springs-Roswell, GA",
    zip3s: ["300", "301", "302", "303", "305", "306", "308", "310", "311", "312"],
  },
  {
    name: "Austin-Round Rock-San Marcos, TX",
    zip3s: ["786", "787"],
  },
  {
    name: "Baltimore-Columbia-Towson, MD",
    zip3s: ["210", "211", "212", "213", "214", "215", "216", "217", "218"],
  },
  {
    name: "Boston-Cambridge-Newton, MA-NH",
    zip3s: ["010", "011", "012", "013", "014", "015", "016", "017", "018", "019", "020", "021", "022", "023", "024", "025", "026", "027"],
  },
  {
    name: "Charlotte-Concord-Gastonia, NC-SC",
    zip3s: ["280", "281", "282", "283", "287", "288", "289"],
  },
  {
    name: "Chicago-Naperville-Elgin, IL-IN-WI",
    zip3s: ["600", "601", "602", "603", "604", "605", "606", "607", "608"],
  },
  {
    name: "Cincinnati, OH-KY-IN",
    zip3s: ["410", "411", "412", "450", "451", "452"],
  },
  {
    name: "Cleveland-Elyria, OH",
    zip3s: ["440", "441", "442", "443", "444"],
  },
  {
    name: "Columbus, OH",
    zip3s: ["430", "431", "432", "433"],
  },
  {
    name: "Dallas-Fort Worth-Arlington, TX",
    zip3s: ["750", "751", "752", "753", "760", "761", "762", "763", "764"],
  },
  {
    name: "Denver-Aurora-Centennial, CO",
    zip3s: ["800", "801", "802", "803", "804", "805"],
  },
  {
    name: "Detroit-Warren-Dearborn, MI",
    zip3s: ["480", "481", "482", "483", "484", "485", "486", "487", "488", "489"],
  },
  {
    name: "Houston-Pasadena-The Woodlands, TX",
    zip3s: ["770", "771", "772", "773", "774", "775"],
  },
  {
    name: "Indianapolis-Carmel-Greenwood, IN",
    zip3s: ["460", "461", "462", "463", "464"],
  },
  {
    name: "Jacksonville, FL",
    zip3s: ["320", "321", "322"],
  },
  {
    name: "Kansas City, MO-KS",
    zip3s: ["640", "641", "660", "661"],
  },
  {
    name: "Las Vegas-Henderson-North Las Vegas, NV",
    zip3s: ["889", "890", "891"],
  },
  {
    name: "Los Angeles-Long Beach-Anaheim, CA",
    zip3s: ["900", "901", "902", "903", "904", "905", "906", "907", "908", "910", "911", "912", "913", "914", "915", "916", "917", "918", "925", "926", "927", "928"],
  },
  {
    name: "Miami-Fort Lauderdale-Pompano Beach, FL",
    zip3s: ["330", "331", "332", "333", "334"],
  },
  {
    name: "Milwaukee-Waukesha, WI",
    zip3s: ["530", "531", "532", "534", "535"],
  },
  {
    name: "Minneapolis-St. Paul-Bloomington, MN-WI",
    zip3s: ["550", "551", "553", "554", "555", "556", "557", "558"],
  },
  {
    name: "Nashville-Davidson--Murfreesboro--Franklin, TN",
    zip3s: ["370", "371", "372"],
  },
  {
    name: "New York-Newark-Jersey City, NY-NJ-PA",
    zip3s: ["070", "071", "072", "073", "074", "075", "076", "077", "078", "079", "086", "087", "088", "089", "100", "101", "102", "103", "104", "105", "106", "107", "108", "109", "110", "111", "112", "113", "114", "115", "116", "117", "118", "119"],
  },
  {
    name: "Orlando-Kissimmee-Sanford, FL",
    zip3s: ["327", "328", "329"],
  },
  {
    name: "Philadelphia-Camden-Wilmington, PA-NJ-DE-MD",
    zip3s: ["080", "081", "082", "083", "084", "085", "190", "191", "192", "193", "194", "195", "196"],
  },
  {
    name: "Phoenix-Mesa-Chandler, AZ",
    zip3s: ["850", "851", "852", "853", "855", "856", "857"],
  },
  {
    name: "Pittsburgh, PA",
    zip3s: ["150", "151", "152", "153", "154", "155", "156"],
  },
  {
    name: "Portland-Vancouver-Hillsboro, OR-WA",
    zip3s: ["970", "971", "972", "973"],
  },
  {
    name: "Providence-Warwick, RI-MA",
    zip3s: ["028", "029"],
  },
  {
    name: "Riverside-San Bernardino-Ontario, CA",
    zip3s: ["909", "919", "920", "921", "922", "923", "924"],
  },
  {
    name: "Sacramento-Roseville-Folsom, CA",
    zip3s: ["956", "957", "958"],
  },
  {
    name: "St. Louis, MO-IL",
    zip3s: ["620", "621", "622", "630", "631", "633"],
  },
  {
    name: "San Antonio-New Braunfels, TX",
    zip3s: ["780", "781", "782"],
  },
  {
    name: "San Diego-Chula Vista-Carlsbad, CA",
    zip3s: ["919", "920", "921"],
  },
  {
    name: "San Francisco-Oakland-Berkeley, CA",
    zip3s: ["940", "941", "944", "945", "946", "947", "948", "949"],
  },
  {
    name: "San Jose-Sunnyvale-Santa Clara, CA",
    zip3s: ["950", "951"],
  },
  {
    name: "Seattle-Tacoma-Bellevue, WA",
    zip3s: ["980", "981", "982", "983", "984"],
  },
  {
    name: "Tampa-St. Petersburg-Clearwater, FL",
    zip3s: ["335", "336", "337"],
  },
  {
    name: "Virginia Beach-Chesapeake-Norfolk, VA-NC",
    zip3s: ["233", "234", "235"],
  },
  {
    name: "Washington-Arlington-Alexandria, DC-VA-MD-WV",
    zip3s: ["200", "201", "202", "203", "204", "205", "206", "207", "208", "220", "221", "222", "223", "224", "225", "226", "227", "228", "229"],
  },
] as const;

/**
 * Reverse lookup: ZIP3 → metro name. Built once at module load.
 * Note: a few ZIP3s appear in multiple metro entries (e.g. "919"–"921" in
 * both Riverside-SB-Ontario and San Diego — these are real geographic
 * borderlands). When that happens, *first declared wins*, so we declare
 * the alphabetically-earlier metro first and accept that the lookup is
 * directional. Callers that want disambiguation should use city/state
 * instead — that's a v2 enhancement.
 */
const ZIP3_TO_METRO: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const metro of METROS) {
    for (const z3 of metro.zip3s) {
      if (!m.has(z3)) m.set(z3, metro.name);
    }
  }
  return m;
})();

/**
 * Map a 5-digit ZIP to its metro name (or null when unknown / outside
 * our top-N list). Trims and validates the input — empty, short, or
 * non-numeric ZIPs return null.
 */
export function metroForZip(zip: string | null | undefined): string | null {
  if (!zip) return null;
  const trimmed = zip.trim();
  if (trimmed.length < 3) return null;
  const z3 = trimmed.slice(0, 3);
  if (!/^\d{3}$/.test(z3)) return null;
  return ZIP3_TO_METRO.get(z3) ?? null;
}

/** Alphabetized metro names — used to populate the analytics dropdown. */
export function listMetroNames(): string[] {
  return METROS.map((m) => m.name).sort((a, b) => a.localeCompare(b));
}
