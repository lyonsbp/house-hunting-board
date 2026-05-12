import { describe, expect, it } from "vitest";

import { readImageDimensions } from "@/lib/image-meta";

function bytes(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function pngWith(width: number, height: number): Uint8Array {
  // 8-byte signature, then IHDR (length=13, type=IHDR, width, height, ...).
  const buf = new Uint8Array(24);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(buf.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return buf;
}

function gifWith(width: number, height: number): Uint8Array {
  // "GIF89a" header + LSD with little-endian width/height at offsets 6 and 8.
  const buf = new Uint8Array(13);
  buf.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
  const view = new DataView(buf.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return buf;
}

function jpegWith(width: number, height: number): Uint8Array {
  // SOI + a single SOF0 marker. Real JPEGs have JFIF/Exif chunks ahead of the
  // SOF; we keep the test minimal — the parser walks markers, it doesn't
  // depend on JFIF being present.
  const buf = new Uint8Array(20);
  buf.set([0xff, 0xd8], 0);
  buf.set([0xff, 0xc0], 2);
  const view = new DataView(buf.buffer);
  view.setUint16(4, 11, false); // segment length
  view.setUint8(6, 8); // precision
  view.setUint16(7, height, false);
  view.setUint16(9, width, false);
  view.setUint8(11, 3); // components
  return buf;
}

function webpVp8XWith(width: number, height: number): Uint8Array {
  // RIFF container with the VP8X (extended) chunk. Stores (w-1, h-1) as
  // 24-bit little-endian values at offsets 24..29.
  const buf = new Uint8Array(30);
  buf.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  buf.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  buf.set([0x56, 0x50, 0x38, 0x58], 12); // "VP8X"
  const w = width - 1;
  const h = height - 1;
  buf[24] = w & 0xff;
  buf[25] = (w >> 8) & 0xff;
  buf[26] = (w >> 16) & 0xff;
  buf[27] = h & 0xff;
  buf[28] = (h >> 8) & 0xff;
  buf[29] = (h >> 16) & 0xff;
  return buf;
}

describe("readImageDimensions", () => {
  it("parses PNG IHDR", () => {
    expect(readImageDimensions(pngWith(1920, 1080))).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it("parses JPEG SOF0", () => {
    expect(readImageDimensions(jpegWith(640, 480))).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("parses GIF LSD", () => {
    expect(readImageDimensions(gifWith(300, 200))).toEqual({
      width: 300,
      height: 200,
    });
  });

  it("parses WebP VP8X canvas size", () => {
    expect(readImageDimensions(webpVp8XWith(2500, 1500))).toEqual({
      width: 2500,
      height: 1500,
    });
  });

  it("returns null for unrecognized formats", () => {
    expect(readImageDimensions(bytes([0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });

  it("returns null for short buffers", () => {
    expect(readImageDimensions(bytes([0xff, 0xd8]))).toBeNull();
  });
});
