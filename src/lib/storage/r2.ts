import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  type ArtifactBundle,
  type BundleInput,
  type ImageExt,
  type ImageStorage,
  type StoredObjectRef,
  type Variant,
  buildKey,
} from "./types";

/**
 * Cloudflare R2 backend.
 *
 * Wires through the `ARTIFACTS_R2` binding declared in wrangler.jsonc and
 * served publicly via a Cache-Rule-fronted custom domain
 * (R2_PUBLIC_BASE env var). Objects are written with
 * `Cache-Control: public, max-age=31536000, immutable` so that once a
 * content-hashed URL has been fetched once, CF's edge cache absorbs all
 * repeat traffic for free.
 *
 * Reachability: only valid inside the Workers runtime (or wrangler dev).
 * `pnpm dev` (plain Next) cannot access the binding — callers should
 * keep STORAGE_BACKEND='supabase' for local Node dev, or run via
 * `pnpm preview` (wrangler dev) when exercising R2 paths.
 */

const CACHE_HEADER = "public, max-age=31536000, immutable";

type R2Object = {
  arrayBuffer(): Promise<ArrayBuffer>;
  httpMetadata?: { contentType?: string };
};

type R2Binding = {
  put(
    key: string,
    value: ArrayBuffer | ReadableStream | Blob,
    options?: {
      httpMetadata?: {
        contentType?: string;
        cacheControl?: string;
      };
    },
  ): Promise<unknown>;
  head(key: string): Promise<unknown | null>;
  get(key: string): Promise<R2Object | null>;
  delete(keys: string | string[]): Promise<void>;
};

function getBucket(): R2Binding {
  const env = getCloudflareContext().env as unknown as {
    ARTIFACTS_R2?: R2Binding;
  };
  if (!env.ARTIFACTS_R2) {
    throw new Error(
      "ARTIFACTS_R2 binding unavailable. Run via wrangler (pnpm preview / deploy) " +
        "or keep STORAGE_BACKEND=supabase for plain `pnpm dev`.",
    );
  }
  return env.ARTIFACTS_R2;
}

function publicBase(): string {
  const base = process.env.R2_PUBLIC_BASE;
  if (!base) {
    throw new Error(
      "R2_PUBLIC_BASE env var is unset. Configure the artifact bucket's " +
        "public custom domain (e.g. https://img.example.com).",
    );
  }
  return base.replace(/\/$/, "");
}

function contentType(ext: ImageExt): string {
  switch (ext) {
    case "avif":
      return "image/avif";
    case "webp":
      return "image/webp";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
  }
}

async function putVariant(
  contentHash: string,
  variant: Variant,
  blob: Blob,
  ext: ImageExt,
): Promise<StoredObjectRef> {
  const key = buildKey(contentHash, variant, ext);
  const bucket = getBucket();
  const body = await blob.arrayBuffer();
  await bucket.put(key, body, {
    httpMetadata: {
      contentType: contentType(ext),
      cacheControl: CACHE_HEADER,
    },
  });
  return { key, ext };
}

export const r2Storage: ImageStorage = {
  async putBundle(input: BundleInput): Promise<ArtifactBundle> {
    const { contentHash } = input;
    const [thumb, display, original] = await Promise.all([
      putVariant(contentHash, "thumb", input.thumb.blob, input.thumb.ext),
      putVariant(contentHash, "display", input.display.blob, input.display.ext),
      putVariant(contentHash, "original", input.original.blob, input.original.ext),
    ]);
    return {
      contentHash,
      variants: { thumb, display, original },
    };
  },

  async putOne(
    contentHash: string,
    variant: Variant,
    blob: Blob,
    ext: ImageExt,
  ): Promise<StoredObjectRef> {
    return putVariant(contentHash, variant, blob, ext);
  },

  async remove(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const bucket = getBucket();
    await bucket.delete(keys);
  },

  publicUrl(key: string): string {
    return `${publicBase()}/${key}`;
  },

  async has(
    contentHash: string,
    variant: Variant,
    ext: ImageExt,
  ): Promise<boolean> {
    const key = buildKey(contentHash, variant, ext);
    const bucket = getBucket();
    const obj = await bucket.head(key);
    return obj != null;
  },

  async get(
    key: string,
  ): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
    const bucket = getBucket();
    const obj = await bucket.get(key);
    if (!obj) return null;
    const bytes = await obj.arrayBuffer();
    const contentType = obj.httpMetadata?.contentType ?? "application/octet-stream";
    return { bytes, contentType };
  },
};
