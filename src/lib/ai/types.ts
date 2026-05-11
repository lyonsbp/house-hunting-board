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

/**
 * The role tag a user can attach to a reference image. Folded into the
 * prompt as a structured hint by the editor (see `ROLE_HINT` in
 * `lib/ai/references.ts`) rather than passed to the model as a separate
 * knob, so adding a new backend doesn't need bespoke role plumbing.
 */
export type ReferenceRole =
  | "style"
  | "color"
  | "materials"
  | "scale"
  | "placement"
  | "other";

export interface ReferenceImage {
  source: ImageSource;
  role?: ReferenceRole;
  /** 1-based slot the user attached this in. Surfaced in the prompt hint. */
  index: number;
}

export interface ImageEditRequest {
  source: ImageSource;
  prompt: string;
  /** 1 for an Edit; N for a Remix fan-out. */
  variants: number;
  seed?: number;
  /** Up to 3; ordered by slot index. Empty/undefined when the user attached none. */
  references?: ReferenceImage[];
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
