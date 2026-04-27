/**
 * The model identifier persisted into `ai_edits.model`. Add a new value here
 * when introducing a new backend.
 */
export type ImageEditModel =
  | "gemini-2.5-flash-image"
  | "flux-kontext"
  | "comfyui-flux-kontext"
  | "comfyui-qwen-image-edit";

export type ImageSource =
  | { kind: "bytes"; mimeType: string; bytes: Uint8Array }
  | { kind: "url"; url: string };

export interface ImageEditRequest {
  source: ImageSource;
  prompt: string;
  /** 1 for an Edit; N for a Remix fan-out. */
  variants: number;
  seed?: number;
}

export interface ImageEditResult {
  /** 0..variants-1, mirrors `ai_edits.variant_index`. */
  variantIndex: number;
  image: { mimeType: string; bytes: Uint8Array };
  /** Null when cost is not billable (e.g. local ComfyUI). */
  costCents: number | null;
  providerMeta: Record<string, unknown>;
}

/**
 * Backend contract. Implementations are pure model dispatch — they do not
 * touch Supabase, Storage, the quota counter, or the `ai_edits` table.
 * The caller (route handler / worker) owns:
 *   - pulling the source image from Storage and signing URLs
 *   - quota enforcement
 *   - writing `ai_edits` (pending → succeeded/failed)
 *   - uploading outputs and creating child `artifacts` rows
 */
export interface ImageEditor {
  readonly model: ImageEditModel;
  edit(req: ImageEditRequest): Promise<ImageEditResult[]>;
}
