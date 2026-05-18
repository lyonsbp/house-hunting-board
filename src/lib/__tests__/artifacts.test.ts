import { describe, expect, it } from "vitest";

import { toArtifact, type ArtifactRow } from "@/lib/artifacts";

const baseRow = {
  id: "00000000-0000-0000-0000-000000000001",
  board_id: "00000000-0000-0000-0000-000000000aaa",
  storage_path: null,
  url: null,
  body: null,
  metadata: null,
  created_at: "2026-01-01T00:00:00Z",
} satisfies Omit<ArtifactRow, "kind">;

describe("toArtifact", () => {
  it("projects a note row", () => {
    const out = toArtifact({ ...baseRow, kind: "note", body: "buy a couch" });
    expect(out).toEqual({
      kind: "note",
      id: baseRow.id,
      boardId: baseRow.board_id,
      body: "buy a couch",
      createdAt: baseRow.created_at,
    });
  });

  it("projects a text row with empty body fallback", () => {
    const out = toArtifact({ ...baseRow, kind: "text", body: null });
    expect(out).toMatchObject({ kind: "text", body: "" });
  });

  it("projects a link row and reads OG metadata under both snake and camel keys", () => {
    const snake = toArtifact({
      ...baseRow,
      kind: "link",
      url: "https://example.com/listing",
      metadata: {
        title: "Mid-century ranch",
        description: "3 bed / 2 bath",
        image_url: "https://example.com/og.jpg",
      },
    });
    expect(snake).toMatchObject({
      kind: "link",
      url: "https://example.com/listing",
      metadata: {
        title: "Mid-century ranch",
        description: "3 bed / 2 bath",
        imageUrl: "https://example.com/og.jpg",
      },
    });

    const camel = toArtifact({
      ...baseRow,
      kind: "link",
      url: "https://example.com/listing",
      metadata: { imageUrl: "https://example.com/og.jpg" },
    });
    expect(camel).toMatchObject({
      metadata: { imageUrl: "https://example.com/og.jpg" },
    });
  });

  it("falls back to empty link metadata when row.metadata is null", () => {
    const out = toArtifact({
      ...baseRow,
      kind: "link",
      url: "https://example.com",
      metadata: null,
    });
    expect(out).toMatchObject({ kind: "link", metadata: {} });
  });

  it("projects an image row and treats empty body as undefined", () => {
    const out = toArtifact({
      ...baseRow,
      kind: "image",
      storage_path: "boards/aaa/uuid.png",
      body: null,
    });
    expect(out).toMatchObject({
      kind: "image",
      id: baseRow.id,
      boardId: baseRow.board_id,
      storagePath: "boards/aaa/uuid.png",
      storageBackend: "supabase",
      body: undefined,
      createdAt: baseRow.created_at,
    });
  });

  it("projects an R2-backed image row with storage_backend='r2'", () => {
    const out = toArtifact({
      ...baseRow,
      kind: "image",
      storage_path: null,
      storage_backend: "r2",
      body: null,
      metadata: { variants: { thumb: { key: "v1/aa/abc/thumb.avif", ext: "avif" } } },
    });
    expect(out).toMatchObject({
      kind: "image",
      storagePath: "",
      storageBackend: "r2",
    });
  });

  it("throws on an unknown kind", () => {
    expect(() => toArtifact({ ...baseRow, kind: "video" })).toThrow(
      /unknown artifact kind/i,
    );
  });
});
