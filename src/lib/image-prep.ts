/**
 * Browser-only helper that extracts an image's natural dimensions and
 * generates a tiny data-URL LQIP (Low-Quality Image Placeholder) before
 * the file is uploaded. Both pieces ride along on the FormData and get
 * persisted into `artifacts.metadata` so the grid can render an exact
 * aspect-ratio shimmer + blurred backdrop instantly, with no CLS.
 *
 * The original `file` is returned unchanged. Re-encoding the upload
 * itself is the caller's choice (see resizeRefImage for the AI-edit
 * path) — for board uploads we keep the source pixels so Supabase
 * Image Transformations can derive variants on demand.
 */

const LQIP_LONG_EDGE = 32;
const LQIP_QUALITY = 0.4;
const MAX_FALLBACK_LQIP_LENGTH = 4_000; // ~3KB; sanity bound for metadata jsonb

export type PreparedImage = {
  file: File;
  width: number;
  height: number;
  /** Tiny base64 JPEG data URL; suitable for `background-image`. */
  lqip: string | null;
};

export async function prepareImageForUpload(file: File): Promise<PreparedImage> {
  if (typeof window === "undefined") {
    throw new Error("prepareImageForUpload is browser-only");
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { file, width: 0, height: 0, lqip: null };
  }

  const width = bitmap.width;
  const height = bitmap.height;
  const lqip = await renderLqip(bitmap).catch(() => null);
  bitmap.close?.();

  return {
    file,
    width,
    height,
    lqip:
      lqip && lqip.length <= MAX_FALLBACK_LQIP_LENGTH ? lqip : null,
  };
}

async function renderLqip(bitmap: ImageBitmap): Promise<string | null> {
  const longEdge = Math.max(bitmap.width, bitmap.height);
  const scale = longEdge > LQIP_LONG_EDGE ? LQIP_LONG_EDGE / longEdge : 1;
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas =
    typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = canvas.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, w, h);

  const blob = await canvasToBlob(canvas, "image/jpeg", LQIP_QUALITY);
  return blobToDataUrl(blob);
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
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("FileReader returned non-string"));
    };
    reader.readAsDataURL(blob);
  });
}
