/**
 * Browser-only multi-variant image encoder.
 *
 * Takes a source File (paste / file upload) and emits three blobs:
 *   - thumb   — 400px long edge, AVIF q=0.6 (fallback WebP q=0.75)
 *   - display — 1200px long edge, AVIF q=0.7 (fallback WebP q=0.8)
 *   - original — input bytes unmodified, kept for AI-edit source material
 *
 * Plus the SHA-256 of the original bytes (R2 key derives from this) and
 * a tiny LQIP data URL for the grid's blurred backdrop.
 *
 * AVIF encoding via canvas.convertToBlob is supported in modern Chrome /
 * Firefox / Safari 17+, but the spec leaves it implementation-defined.
 * We feature-detect once per session and fall back to WebP.
 */

const THUMB_LONG_EDGE = 400;
const DISPLAY_LONG_EDGE = 1200;
const THUMB_QUALITY_AVIF = 0.6;
const DISPLAY_QUALITY_AVIF = 0.7;
const THUMB_QUALITY_WEBP = 0.75;
const DISPLAY_QUALITY_WEBP = 0.8;

const LQIP_LONG_EDGE = 32;
const LQIP_QUALITY = 0.4;
const MAX_LQIP_LENGTH = 4_000;

export type EncodedExt = "avif" | "webp" | "jpeg" | "png";

export type EncodedVariant = {
  blob: Blob;
  ext: EncodedExt;
  bytes: number;
};

export type EncodedBundle = {
  thumb: EncodedVariant;
  display: EncodedVariant;
  original: EncodedVariant;
  width: number;
  height: number;
  lqip: string | null;
  /** Lowercase sha256 hex of the original file bytes. */
  contentHash: string;
};

export async function encodeVariants(file: File): Promise<EncodedBundle> {
  if (typeof window === "undefined") {
    throw new Error("encodeVariants is browser-only");
  }

  const originalBytes = await file.arrayBuffer();
  const [bitmap, contentHash, supportsAvif] = await Promise.all([
    createImageBitmap(file),
    sha256Hex(originalBytes),
    detectAvifSupport(),
  ]);

  const targetMime = supportsAvif ? "image/avif" : "image/webp";
  const targetExt: EncodedExt = supportsAvif ? "avif" : "webp";

  try {
    const [thumb, display, lqip] = await Promise.all([
      encodeAtLongEdge(
        bitmap,
        THUMB_LONG_EDGE,
        targetMime,
        supportsAvif ? THUMB_QUALITY_AVIF : THUMB_QUALITY_WEBP,
      ),
      encodeAtLongEdge(
        bitmap,
        DISPLAY_LONG_EDGE,
        targetMime,
        supportsAvif ? DISPLAY_QUALITY_AVIF : DISPLAY_QUALITY_WEBP,
      ),
      renderLqip(bitmap),
    ]);

    return {
      thumb: { blob: thumb, ext: targetExt, bytes: thumb.size },
      display: { blob: display, ext: targetExt, bytes: display.size },
      original: {
        blob: new Blob([originalBytes], { type: file.type }),
        ext: extFromMime(file.type),
        bytes: originalBytes.byteLength,
      },
      width: bitmap.width,
      height: bitmap.height,
      lqip: lqip && lqip.length <= MAX_LQIP_LENGTH ? lqip : null,
      contentHash,
    };
  } finally {
    bitmap.close?.();
  }
}

async function encodeAtLongEdge(
  bitmap: ImageBitmap,
  longEdge: number,
  type: string,
  quality: number,
): Promise<Blob> {
  const src = Math.max(bitmap.width, bitmap.height);
  const scale = src > longEdge ? longEdge / src : 1;
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvasToBlob(canvas, type, quality);
}

async function renderLqip(bitmap: ImageBitmap): Promise<string | null> {
  try {
    const src = Math.max(bitmap.width, bitmap.height);
    const scale = src > LQIP_LONG_EDGE ? LQIP_LONG_EDGE / src : 1;
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await canvasToBlob(canvas, "image/jpeg", LQIP_QUALITY);
    return blobToDataUrl(blob);
  } catch {
    return null;
  }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(w, h);
  return Object.assign(document.createElement("canvas"), { width: w, height: h });
}

function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type: string,
  quality: number,
): Promise<Blob> {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({ type, quality });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
      type,
      quality,
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error ?? new Error("FileReader failed"));
    r.onload = () => {
      const v = r.result;
      if (typeof v === "string") resolve(v);
      else reject(new Error("FileReader returned non-string"));
    };
    r.readAsDataURL(blob);
  });
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < arr.length; i++) {
    hex += arr[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}

function extFromMime(mime: string): EncodedExt {
  // Preserve the user's original format for the `original` variant.
  // Anything we can't recognize falls back to webp — but in practice
  // ALLOWED_IMAGE_TYPES on the server validates this.
  switch (mime) {
    case "image/avif":
      return "avif";
    case "image/webp":
      return "webp";
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
      return "jpeg";
    default:
      return "webp";
  }
}

let avifProbe: Promise<boolean> | null = null;

async function detectAvifSupport(): Promise<boolean> {
  if (avifProbe) return avifProbe;
  avifProbe = (async () => {
    try {
      const canvas = makeCanvas(1, 1);
      const ctx = canvas.getContext("2d") as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;
      if (!ctx) return false;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, 1, 1);
      const blob = await canvasToBlob(canvas, "image/avif", 0.5);
      return blob.type === "image/avif";
    } catch {
      return false;
    }
  })();
  return avifProbe;
}
