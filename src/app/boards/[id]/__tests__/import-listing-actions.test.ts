/**
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ListingPreview } from "@/lib/listings/types";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect called — user not signed in");
  },
}));

const getCurrentUser = vi.fn();
vi.mock("@/lib/auth", () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUser(...args),
}));

const userClient = {
  from: vi.fn(),
  storage: {
    from: vi.fn(),
  },
};
const adminClient = { from: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => userClient),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => adminClient),
}));

const FIXTURE_DIR = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "lib",
  "listings",
  "__tests__",
  "__fixtures__",
);
const REDFIN_HTML = readFileSync(join(FIXTURE_DIR, "redfin-embedded.html"), "utf-8");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ sub: "user-1" });

  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("previewListing", () => {
  it("returns a ready preview for a Redfin URL", async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse(REDFIN_HTML));

    const { previewListing } = await import("../import-listing-actions");
    const fd = new FormData();
    fd.set("boardId", "12345678-1234-4abc-8def-1234567890ab");
    fd.set("url", "https://www.redfin.com/WA/Seattle/x/home/1");

    const out = await previewListing({ status: "idle" }, fd);
    expect(out.status).toBe("ready");
    if (out.status === "ready") {
      expect(out.preview.images.length).toBe(3);
      expect(out.preview.property.source).toBe("redfin");
      expect(out.preview.property.address).toBe("2661 Crestview Dr");
    }
  });

  it("returns an unsupported error for non-listing hosts", async () => {
    const { previewListing } = await import("../import-listing-actions");
    const fd = new FormData();
    fd.set("boardId", "12345678-1234-4abc-8def-1234567890ab");
    fd.set("url", "https://example.com/foo");

    const out = await previewListing({ status: "idle" }, fd);
    expect(out.status).toBe("error");
    if (out.status === "error") {
      expect(out.code).toBe("unsupported");
    }
  });

  it("returns a blocked error when the source returns 403", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("nope", { status: 403, headers: { "content-type": "text/html" } }),
    );
    const { previewListing } = await import("../import-listing-actions");
    const fd = new FormData();
    fd.set("boardId", "12345678-1234-4abc-8def-1234567890ab");
    fd.set("url", "https://www.zillow.com/homedetails/x/1_zpid/");

    const out = await previewListing({ status: "idle" }, fd);
    expect(out.status).toBe("error");
    if (out.status === "error") {
      expect(out.code).toBe("blocked");
    }
  });
});

describe("commitListingImport", () => {
  const boardId = "12345678-1234-4abc-8def-1234567890ab";
  const previewUrl = "https://www.redfin.com/WA/Seattle/x/home/1";

  function basePreview(): ListingPreview {
    return {
      pathway: "embedded-json",
      partial: false,
      scrapedAt: "2026-04-26T00:00:00Z",
      property: {
        source: "redfin",
        sourceUrl: previewUrl,
        address: "123 Maple St",
        city: "Seattle",
        state: "WA",
        zip: "98101",
        listPrice: 875000,
        bedrooms: 3,
        bathrooms: 2.5,
        sqft: 1850,
        yearBuilt: 1972,
        raw: { test: true },
      },
      images: [
        { url: "https://ssl.cdn-redfin.com/photo/1.jpg" },
        { url: "https://ssl.cdn-redfin.com/photo/2.jpg" },
      ],
    };
  }

  function setupSuccessfulSupabase() {
    const propertyUpsert = {
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: "prop-1" }, error: null }),
      }),
    };
    adminClient.from.mockImplementation((table: string) => {
      if (table === "properties") {
        return { upsert: vi.fn().mockReturnValue(propertyUpsert) };
      }
      throw new Error(`unexpected admin table ${table}`);
    });

    const upload = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn().mockResolvedValue({ error: null });
    userClient.storage.from.mockReturnValue({ upload, remove });

    let nextArtifactId = 100;
    userClient.from.mockImplementation((table: string) => {
      if (table === "board_members") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { role: "owner" },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "artifacts") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: `art-${nextArtifactId++}` },
                error: null,
              }),
            }),
          }),
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      if (table === "property_artifacts") {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      throw new Error(`unexpected user table ${table}`);
    });

    return { upload, remove };
  }

  it("rejects a selection containing a URL not in the cached preview", async () => {
    const preview = basePreview();
    const { commitListingImport } = await import("../import-listing-actions");

    const fd = new FormData();
    fd.set("boardId", boardId);
    fd.set("url", previewUrl);
    fd.set("cachedPreview", JSON.stringify(preview));
    fd.set(
      "selectedImageUrls",
      JSON.stringify(["https://evil.example.com/steal-me.png"]),
    );

    const out = await commitListingImport({ status: "idle" }, fd);
    expect(out.status).toBe("error");
    if (out.status === "error") {
      expect(out.message).toMatch(/aren't part of the previewed listing/i);
    }
  });

  it("imports each selected image and writes property + artifacts + links", async () => {
    setupSuccessfulSupabase();

    fetchMock.mockImplementation(
      async () =>
        new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
    );

    const { commitListingImport } = await import("../import-listing-actions");
    const preview = basePreview();
    const fd = new FormData();
    fd.set("boardId", boardId);
    fd.set("url", previewUrl);
    fd.set("cachedPreview", JSON.stringify(preview));
    fd.set("selectedImageUrls", JSON.stringify(preview.images.map((i) => i.url)));

    const out = await commitListingImport({ status: "idle" }, fd);
    expect(out.status).toBe("done");
    if (out.status === "done") {
      expect(out.succeeded).toBe(2);
      expect(out.failed).toBe(0);
    }
    expect(adminClient.from).toHaveBeenCalledWith("properties");
    expect(userClient.from).toHaveBeenCalledWith("artifacts");
    expect(userClient.from).toHaveBeenCalledWith("property_artifacts");
  });

  it("rolls back the storage object when the artifact insert fails", async () => {
    const { upload, remove } = setupSuccessfulSupabase();
    // Override artifacts.insert to fail.
    userClient.from.mockImplementation((table: string) => {
      if (table === "board_members") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { role: "owner" },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "artifacts") {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: "RLS" },
              }),
            }),
          }),
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      if (table === "property_artifacts") {
        return { insert: vi.fn().mockResolvedValue({ error: null }) };
      }
      throw new Error(`unexpected ${table}`);
    });

    fetchMock.mockImplementation(
      async () =>
        new Response(new Uint8Array([0xff, 0xd8]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
    );

    const { commitListingImport } = await import("../import-listing-actions");
    const preview = basePreview();
    const fd = new FormData();
    fd.set("boardId", boardId);
    fd.set("url", previewUrl);
    fd.set("cachedPreview", JSON.stringify(preview));
    fd.set("selectedImageUrls", JSON.stringify([preview.images[0].url]));

    const out = await commitListingImport({ status: "idle" }, fd);
    expect(out.status).toBe("done");
    if (out.status === "done") {
      expect(out.succeeded).toBe(0);
      expect(out.failed).toBe(1);
    }
    expect(upload).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
  });
});

function htmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
