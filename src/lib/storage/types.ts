/**
 * Shared types for the image storage abstraction.
 *
 * The abstraction exists so a single env flag (`STORAGE_BACKEND`) can flip
 * artifact-image writes between Supabase Storage and Cloudflare R2 without
 * touching call sites. Reads remain backend-agnostic — each artifact row
 * carries its own `storage_backend` column that the URL resolver reads.
 */

export type Variant = "thumb" | "display" | "original";

export const VARIANTS: readonly Variant[] = ["thumb", "display", "original"] as const;

/** Allowed encoded image extensions. Source of truth for variant URLs. */
export type ImageExt = "avif" | "webp" | "jpg" | "jpeg" | "png";

export type StoredObjectRef = {
  /** Path within the bucket, NOT including the public-base prefix. */
  key: string;
  ext: ImageExt;
};

/** Result of writing a multi-variant bundle. */
export type ArtifactBundle = {
  contentHash: string;
  variants: Record<Variant, StoredObjectRef>;
};

/** Input to putBundle: the three encoded blobs plus the original. */
export type BundleInput = {
  contentHash: string;
  thumb: { blob: Blob; ext: ImageExt };
  display: { blob: Blob; ext: ImageExt };
  original: { blob: Blob; ext: ImageExt };
};

export interface ImageStorage {
  /**
   * Upload all three variants for one image. Idempotent: if `has()`
   * returns true for the original variant, callers should skip calling
   * this. Implementations may also no-op on hash-collision for safety.
   */
  putBundle(input: BundleInput): Promise<ArtifactBundle>;

  /** Single-variant write (used by AI-edit output where source already exists). */
  putOne(
    contentHash: string,
    variant: Variant,
    blob: Blob,
    ext: ImageExt,
  ): Promise<StoredObjectRef>;

  /**
   * Delete object(s) by key. NOTE: app code MUST NOT call this until the
   * GC-by-refcount worker lands. Two artifact rows can share the same
   * content_hash (dedupe path), so a row-level delete cannot safely
   * imply an R2 delete. Kept on the interface for the future GC worker.
   */
  remove(keys: string[]): Promise<void>;

  /** Returns the public URL for a stored key. Pure string concat for R2. */
  publicUrl(key: string): string;

  /**
   * Cheap existence probe used to dedupe re-uploads of identical bytes
   * (e.g. the same Redfin photo pasted on two boards). HEAD-style.
   */
  has(contentHash: string, variant: Variant, ext: ImageExt): Promise<boolean>;

  /**
   * Fetch the bytes of a stored object. Used by AI-edit input flows
   * that need to re-read an image (the model can't accept a URL when
   * the bucket is on a custom domain we don't proxy). Returns null if
   * the object is missing.
   */
  get(key: string): Promise<{ bytes: ArrayBuffer; contentType: string } | null>;
}

/**
 * Content-addressed key scheme.
 *
 * `v1/{prefix2}/{sha256}/{variant}.{ext}` where prefix2 is the first 2
 * hex chars of the hash. The fan-out keeps R2 list operations tractable
 * later (256 prefix buckets); a v2 schema can be added without rewriting
 * existing keys because the prefix is encoded.
 */
export function buildKey(
  contentHash: string,
  variant: Variant,
  ext: ImageExt,
): string {
  if (!/^[0-9a-f]{64}$/.test(contentHash)) {
    throw new Error("contentHash must be lowercase sha256 hex");
  }
  return `v1/${contentHash.slice(0, 2)}/${contentHash}/${variant}.${ext}`;
}
