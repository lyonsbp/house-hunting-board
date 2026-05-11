import type {
  ImageEditModel,
  ImageEditRequest,
  ImageEditResult,
  ImageEditor,
} from "../types";

export class FluxKontextEditor implements ImageEditor {
  readonly model: ImageEditModel = "flux-kontext";

  async edit(_req: ImageEditRequest): Promise<ImageEditResult[]> {
    // TODO(M8): when this backend lands, forward `_req.references` to FLUX
    // Kontext's multi-image / Max endpoint and prepend role hints from
    // `lib/ai/role-hints.ts` to the prompt (mirrors the Gemini path).
    throw new Error("FluxKontextEditor not implemented (M3)");
  }
}
