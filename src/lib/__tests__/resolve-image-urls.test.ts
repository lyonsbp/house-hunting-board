import { afterEach, describe, expect, it, vi } from "vitest";

// resolveImageUrls reaches into the legacy signImagePaths code path for
// supabase-backed rows. That helper hits the Supabase admin client, so
// we mock it at the supabase/admin module level to keep this test
// hermetic. R2 rows resolve via pure string concat — no mocks needed.
const adminMock = vi.hoisted(() => ({
  storage: {
    from: vi.fn(() => ({
      createSignedUrls: vi.fn(async (paths: string[]) => ({
        data: paths.map((p) => ({ path: p, signedUrl: `https://supa.test/${p}?sig=ok` })),
      })),
      createSignedUrl: vi.fn(async (path: string) => ({
        data: { signedUrl: `https://supa.test/${path}?sig=ok` },
      })),
    })),
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => adminMock,
}));

vi.mock("@/lib/storage", () => ({
  storage: {
    publicUrl: (key: string) => `https://img.test/${key}`,
  },
}));

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.R2_PUBLIC_BASE;
  delete process.env.STORAGE_BACKEND;
});

describe("resolveImageUrls", () => {
  it("returns R2 public URLs from variant keys", async () => {
    const { resolveImageUrls } = await import("@/lib/board-data");
    const out = await resolveImageUrls(
      [
        {
          id: "a1",
          storageBackend: "r2",
          metadata: {
            variants: {
              thumb: { key: "v1/aa/HASH/thumb.avif" },
              display: { key: "v1/aa/HASH/display.avif" },
            },
          },
        },
      ],
      "thumb",
    );
    expect(out.get("a1")).toBe("https://img.test/v1/aa/HASH/thumb.avif");
  });

  it("falls back to signed Supabase URLs for legacy rows", async () => {
    const { resolveImageUrls } = await import("@/lib/board-data");
    const out = await resolveImageUrls(
      [
        {
          id: "b2",
          storageBackend: "supabase",
          storagePath: "boards/x/123.jpg",
          metadata: null,
        },
      ],
      "display",
    );
    expect(out.get("b2")).toBe("https://supa.test/boards/x/123.jpg?sig=ok");
  });

  it("skips R2 rows missing the requested variant", async () => {
    const { resolveImageUrls } = await import("@/lib/board-data");
    const out = await resolveImageUrls(
      [
        {
          id: "c3",
          storageBackend: "r2",
          metadata: { variants: { thumb: { key: "v1/aa/HASH/thumb.avif" } } },
        },
      ],
      "display",
    );
    expect(out.has("c3")).toBe(false);
  });

  it("handles a mixed-backend batch in one call", async () => {
    const { resolveImageUrls } = await import("@/lib/board-data");
    const out = await resolveImageUrls(
      [
        {
          id: "r1",
          storageBackend: "r2",
          metadata: {
            variants: { thumb: { key: "v1/aa/HASH/thumb.avif" } },
          },
        },
        {
          id: "s1",
          storageBackend: "supabase",
          storagePath: "boards/y/456.png",
          metadata: null,
        },
      ],
      "thumb",
    );
    expect(out.size).toBe(2);
    expect(out.get("r1")).toBe("https://img.test/v1/aa/HASH/thumb.avif");
    expect(out.get("s1")).toBe("https://supa.test/boards/y/456.png?sig=ok");
  });
});
