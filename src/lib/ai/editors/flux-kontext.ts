import type {
  ImageEditModel,
  ImageEditRequest,
  ImageEditResult,
  ImageEditor,
} from "../types";

export class FluxKontextEditor implements ImageEditor {
  readonly model: ImageEditModel = "flux-kontext";

  async edit(_req: ImageEditRequest): Promise<ImageEditResult[]> {
    throw new Error("FluxKontextEditor not implemented (M3)");
  }
}
