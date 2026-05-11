/**
 * Browser-only helper that resizes a user-picked reference image so the
 * long edge is at most `maxEdge` pixels (default 1024) before we hand it
 * off to the upload action and ultimately the model. Per PRD §5.3a:
 * caps protect token cost on Gemini and request-size limits on FLUX
 * Kontext multi-image.
 *
 * Re-encodes as JPEG (q=0.9) regardless of input format — the model
 * doesn't care, JPEGs are smaller, and we strip EXIF as a side effect.
 * If the source is already smaller than `maxEdge`, we still re-encode
 * for the EXIF-strip + size-floor guarantee.
 */
export async function resizeRefImage(
  file: File,
  maxEdge = 1024,
): Promise<File> {
  if (typeof window === "undefined") {
    throw new Error("resizeRefImage is browser-only");
  }
  const bitmap = await createImageBitmap(file);
  const longEdge = Math.max(bitmap.width, bitmap.height);
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
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
  if (!ctx) {
    bitmap.close?.();
    throw new Error("Canvas 2D context unavailable");
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob = await canvasToBlob(canvas, "image/jpeg", 0.9);
  // Strip the source extension so File.name reads naturally as a .jpg.
  const baseName = file.name.replace(/\.[^.]+$/, "") || "ref";
  return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
}

async function canvasToBlob(
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
