/**
 * Pure-JS image header parsing. Reads width/height out of PNG, JPEG,
 * WebP, and GIF bytes without decoding the image, so it runs cleanly
 * in Server Actions on Cloudflare Workers (no sharp / node-canvas).
 *
 * Used by the upload pipeline to persist dimensions into
 * `artifacts.metadata` at write time, which lets the client render an
 * exact aspect-ratio box before the image arrives — no layout shift,
 * no scanline cascade as cards reflow during paint.
 */

export type ImageDimensions = { width: number; height: number };

export function readImageDimensions(
  bytes: ArrayBuffer | Uint8Array,
  contentType?: string,
): ImageDimensions | null {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // Each format-specific reader applies its own length guard; this is
  // just a floor for the sniff step (8 bytes covers the PNG signature
  // and all other magic-number checks).
  if (u8.length < 8) return null;
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

  const hint = contentType?.toLowerCase().split(";")[0].trim();
  const sniff = sniffFormat(u8);
  const fmt = sniff ?? mimeToFormat(hint);

  switch (fmt) {
    case "png":
      return readPng(view);
    case "jpeg":
      return readJpeg(view);
    case "webp":
      return readWebp(view);
    case "gif":
      return readGif(view);
    default:
      return null;
  }
}

type Format = "png" | "jpeg" | "webp" | "gif";

function mimeToFormat(mime: string | undefined): Format | null {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
      return "jpeg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return null;
  }
}

function sniffFormat(u8: Uint8Array): Format | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    u8[0] === 0x89 &&
    u8[1] === 0x50 &&
    u8[2] === 0x4e &&
    u8[3] === 0x47 &&
    u8[4] === 0x0d &&
    u8[5] === 0x0a &&
    u8[6] === 0x1a &&
    u8[7] === 0x0a
  ) {
    return "png";
  }
  // JPEG: FF D8 FF
  if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return "jpeg";
  // GIF: "GIF87a" or "GIF89a"
  if (
    u8[0] === 0x47 &&
    u8[1] === 0x49 &&
    u8[2] === 0x46 &&
    u8[3] === 0x38 &&
    (u8[4] === 0x37 || u8[4] === 0x39) &&
    u8[5] === 0x61
  ) {
    return "gif";
  }
  // WebP: "RIFF"...."WEBP"
  if (
    u8.length >= 12 &&
    u8[0] === 0x52 &&
    u8[1] === 0x49 &&
    u8[2] === 0x46 &&
    u8[3] === 0x46 &&
    u8[8] === 0x57 &&
    u8[9] === 0x45 &&
    u8[10] === 0x42 &&
    u8[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

function readPng(view: DataView): ImageDimensions | null {
  // After the 8-byte signature, the first chunk must be IHDR. Width and
  // height are at byte offsets 16 and 20 as 32-bit big-endian unsigned.
  if (view.byteLength < 24) return null;
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return positive({ width, height });
}

function readJpeg(view: DataView): ImageDimensions | null {
  // Walk the marker chain looking for any SOFn frame (Start Of Frame).
  // Skip standalone markers (RST, SOI, EOI) which have no payload.
  let offset = 2; // past SOI
  const end = view.byteLength;
  while (offset + 4 < end) {
    if (view.getUint8(offset) !== 0xff) return null;
    let marker = view.getUint8(offset + 1);
    offset += 2;
    // Skip padding bytes — some encoders emit runs of 0xFF before a marker.
    while (marker === 0xff && offset < end) {
      marker = view.getUint8(offset);
      offset += 1;
    }
    // Standalone markers (no segment): SOI/EOI/RST0-7/TEM
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      (marker >= 0xd0 && marker <= 0xd7) ||
      marker === 0x01
    ) {
      continue;
    }
    if (offset + 2 > end) return null;
    const segLen = view.getUint16(offset, false);
    // SOF markers are C0..CF excluding C4 (DHT), C8 (JPG reserved), CC (DAC).
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      if (offset + 7 > end) return null;
      // SOF payload: [len(2)] precision(1) height(2) width(2) components(1)
      const height = view.getUint16(offset + 3, false);
      const width = view.getUint16(offset + 5, false);
      return positive({ width, height });
    }
    offset += segLen;
  }
  return null;
}

function readWebp(view: DataView): ImageDimensions | null {
  // RIFF container: bytes 12..15 are the chunk FourCC.
  if (view.byteLength < 30) return null;
  const chunk =
    String.fromCharCode(view.getUint8(12)) +
    String.fromCharCode(view.getUint8(13)) +
    String.fromCharCode(view.getUint8(14)) +
    String.fromCharCode(view.getUint8(15));

  if (chunk === "VP8 ") {
    // Lossy. Frame tag is 3 bytes at offset 20; width/height live at 26..29 as
    // 14-bit little-endian values with 2 scaling bits above.
    if (view.byteLength < 30) return null;
    const w = view.getUint16(26, true) & 0x3fff;
    const h = view.getUint16(28, true) & 0x3fff;
    return positive({ width: w, height: h });
  }
  if (chunk === "VP8L") {
    // Lossless. Signature byte (0x2f) at 20, then 14-bit width-1 and
    // height-1 packed little-endian across bytes 21..24.
    if (view.byteLength < 25) return null;
    const b0 = view.getUint8(21);
    const b1 = view.getUint8(22);
    const b2 = view.getUint8(23);
    const b3 = view.getUint8(24);
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return positive({ width, height });
  }
  if (chunk === "VP8X") {
    // Extended. Canvas size at 24..29 as two 24-bit little-endian
    // (width-1, height-1) values.
    if (view.byteLength < 30) return null;
    const wMinusOne =
      view.getUint8(24) | (view.getUint8(25) << 8) | (view.getUint8(26) << 16);
    const hMinusOne =
      view.getUint8(27) | (view.getUint8(28) << 8) | (view.getUint8(29) << 16);
    return positive({ width: wMinusOne + 1, height: hMinusOne + 1 });
  }
  return null;
}

function readGif(view: DataView): ImageDimensions | null {
  // Logical Screen Descriptor: width @ 6, height @ 8 (little-endian).
  if (view.byteLength < 10) return null;
  return positive({
    width: view.getUint16(6, true),
    height: view.getUint16(8, true),
  });
}

function positive(d: ImageDimensions): ImageDimensions | null {
  if (
    Number.isFinite(d.width) &&
    Number.isFinite(d.height) &&
    d.width > 0 &&
    d.height > 0
  ) {
    return d;
  }
  return null;
}
