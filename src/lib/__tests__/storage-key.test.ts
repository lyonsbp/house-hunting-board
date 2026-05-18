import { describe, expect, it } from "vitest";

import { buildKey } from "@/lib/storage";

const HASH = "a".repeat(64);

describe("buildKey", () => {
  it("emits v1/<prefix2>/<sha256>/<variant>.<ext>", () => {
    expect(buildKey(HASH, "thumb", "avif")).toBe(
      `v1/aa/${HASH}/thumb.avif`,
    );
  });

  it("uses the variant + ext authoritatively", () => {
    const hash = "0".repeat(64);
    expect(buildKey(hash, "display", "webp")).toBe(
      `v1/00/${hash}/display.webp`,
    );
    expect(buildKey(hash, "original", "jpg")).toBe(
      `v1/00/${hash}/original.jpg`,
    );
  });

  it("rejects non-hex / wrong-length hashes", () => {
    expect(() => buildKey("not-hex", "thumb", "avif")).toThrow();
    expect(() => buildKey("a".repeat(63), "thumb", "avif")).toThrow();
    expect(() => buildKey("A".repeat(64), "thumb", "avif")).toThrow(); // upper-case rejected — must be lowercase
  });
});
