import type {
  ImageEditModel,
  ImageEditRequest,
  ImageEditResult,
  ImageEditor,
} from "../types";

export class GeminiImageEditor implements ImageEditor {
  readonly model: ImageEditModel = "gemini-2.5-flash-image";

  async edit(_req: ImageEditRequest): Promise<ImageEditResult[]> {
    throw new Error("GeminiImageEditor not implemented (M3)");
  }
}
