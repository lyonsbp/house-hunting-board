import type { RefInput } from "@/lib/ai/references";

/** Per-slot UI state for the 3-slot reference row in the AI edit modal. */
export type Slot =
  | { kind: "empty" }
  | { kind: "uploading" }
  | {
      kind: "filled";
      ref: RefInput;
      /** Local preview — blob URL for uploads, signed URL for artifact picks. */
      previewUrl: string;
      /** A URL another board member could open. For uploads, a separately
       * signed URL (blob URLs are scoped to the broadcaster's document and
       * useless to peers). For artifact picks, same as `previewUrl`. */
      broadcastUrl: string;
    };

export const EMPTY_SLOTS: readonly [Slot, Slot, Slot] = [
  { kind: "empty" },
  { kind: "empty" },
  { kind: "empty" },
] as const;
