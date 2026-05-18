/**
 * Server-only multi-variant encoder for the listing scraper + AI-edit
 * output paths. Wraps the Cloudflare Workers `IMAGES` binding so the
 * same R2 variant pipeline that runs in the browser also runs
 * server-side for images we never see on the client.
 *
 * Why the IMAGES binding (vs `@cf-wasm/photon`):
 *   - Zero WASM bundle weight; we stay well under the 10MB Worker limit.
 *   - Supports AVIF output (photon was WebP-only) — ~15% smaller bytes
 *     for the same perceived quality.
 *   - No init() cost on cold start.
 *
 * Requires Workers Paid (Image Resizing is a paid feature). The binding
 * is configured in `wrangler.jsonc` (`images: { binding: "IMAGES" }`)
 * and is already used by OpenNext for `next/image`, so the binding is
 * present in every Worker invocation.
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { readImageDimensions } from "./image-meta";
import type { ImageExt } from "./storage";

const THUMB_LONG_EDGE = 400;
const DISPLAY_LONG_EDGE = 1200;
const THUMB_QUALITY = 60;
const DISPLAY_QUALITY = 70;
const TARGET_FORMAT = "image/avif" as const;
const TARGET_EXT: ImageExt = "avif";

type ImagesBinding = {
  input(stream: ReadableStream): ImagesTransformer;
};
type ImagesTransformer = {
  transform(opts: {
    width?: number;
    height?: number;
    fit?: "scale-down" | "contain" | "cover" | "crop" | "pad";
  }): ImagesTransformer;
  output(opts: {
    format: string;
    quality?: number;
  }): Promise<ImagesTransformResult>;
};
type ImagesTransformResult = {
  response(): Response;
  image(): ReadableStream;
  contentType(): string;
};

export type ServerEncodedBundle = {
  thumb: { blob: Blob; ext: ImageExt };
  display: { blob: Blob; ext: ImageExt };
  original: { blob: Blob; ext: ImageExt };
  width: number;
  height: number;
  /** Lowercase sha256 hex of the original bytes. */
  contentHash: string;
};

export async function encodeServerVariants(opts: {
  bytes: ArrayBuffer | Uint8Array;
  /** MIME type of the original bytes (used for the `original` variant). */
  sourceMime: string;
}): Promise<ServerEncodedBundle> {
  const env = getCloudflareContext().env as unknown as {
    IMAGES?: ImagesBinding;
  };
  if (!env.IMAGES) {
    throw new Error(
      "IMAGES binding unavailable. Run under wrangler (pnpm preview / deploy).",
    );
  }

  // Normalize to a fresh Uint8Array backed by a plain ArrayBuffer so
  // downstream Blob/crypto APIs accept it under TS strict typings.
  const src = toFreshU8(opts.bytes);
  const contentHash = await sha256Hex(src);
  const originalExt = mimeToExt(opts.sourceMime);

  // Read source dimensions from the file header without decoding the
  // whole image — the IMAGES binding doesn't expose them directly.
  const dims = readImageDimensions(src, opts.sourceMime);
  const width = dims?.width ?? 0;
  const height = dims?.height ?? 0;

  const [thumb, display] = await Promise.all([
    encodeOneVariant(env.IMAGES, src, THUMB_LONG_EDGE, THUMB_QUALITY),
    encodeOneVariant(env.IMAGES, src, DISPLAY_LONG_EDGE, DISPLAY_QUALITY),
  ]);

  return {
    thumb: { blob: thumb, ext: TARGET_EXT },
    display: { blob: display, ext: TARGET_EXT },
    original: {
      blob: new Blob([src], { type: opts.sourceMime }),
      ext: originalExt,
    },
    width,
    height,
    contentHash,
  };
}

async function encodeOneVariant(
  images: ImagesBinding,
  src: Uint8Array<ArrayBuffer>,
  longEdge: number,
  quality: number,
): Promise<Blob> {
  // The binding consumes a ReadableStream. Each variant needs its own
  // stream so we can't reuse one — Response.body is fine here.
  const stream = new Response(src).body;
  if (!stream) throw new Error("Could not build ReadableStream from bytes");

  const result = await images
    .input(stream)
    .transform({ width: longEdge, fit: "scale-down" })
    .output({ format: TARGET_FORMAT, quality });
  return result.response().blob();
}

function toFreshU8(input: ArrayBuffer | Uint8Array): Uint8Array<ArrayBuffer> {
  if (input instanceof Uint8Array) {
    const out = new Uint8Array(input.byteLength);
    out.set(input);
    return out as Uint8Array<ArrayBuffer>;
  }
  return new Uint8Array(input) as Uint8Array<ArrayBuffer>;
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < arr.length; i++) {
    out += arr[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

function mimeToExt(mime: string): ImageExt {
  switch (mime.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/avif":
      return "avif";
    default:
      return "jpg";
  }
}
